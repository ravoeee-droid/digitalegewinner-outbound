import { promises as dns } from "node:dns";
import nodemailer from "nodemailer";
import { query, readState } from "@/lib/db";
import { loadMailboxCredentials, type StoredMailboxCredential } from "@/lib/mailbox-credentials";
import { testImapConnection, type ImapMailboxCredential } from "@/lib/imap-client";
import { getMailboxAccessToken } from "@/lib/mailer";
import { recordOutboundEventByMode } from "@/lib/outbound-event-ledger";
import { resolveOutboundRuntimeConfig } from "@/lib/outbound-runtime-config";

export const DELIVERABILITY_POLICY_VERSION="dg-deliverability-2026-09-27-v1";

type HealthStatus="healthy"|"watch"|"degraded"|"paused";
type StateMailbox={id:string;email?:string;enabled?:boolean;dailyLimit:number};
type StatePayload={mailboxes?:StateMailbox[]};

type SenderHealthStateRow={
  target_type:"mailbox"|"domain";
  target_id:string;
  health_status:HealthStatus;
  health_score:number;
  base_daily_limit:number|null;
  recommended_daily_limit:number|null;
  enforced_daily_limit:number|null;
  paused_until:Date|null;
  consecutive_healthy:number;
  consecutive_degraded:number;
  last_action:string|null;
  last_reason:string|null;
  metrics:Record<string,unknown>;
  reasons:string[];
  observed_at:Date;
};

type MailboxMetrics={
  sent24h:number;
  sent7d:number;
  attempts7d:number;
  deferred7d:number;
  failed7d:number;
  bounces7d:number;
  complaints7d:number;
  bounceRate:number;
  complaintRate:number;
  deferralRate:number;
  failureRate:number;
};

type DomainDns={
  domain:string;
  mx:boolean;
  spf:boolean;
  dkim:boolean;
  dmarc:boolean;
  ptr:boolean|null;
  mxHosts:string[];
  dkimSelectors:string[];
  ptrHosts:string[];
};

type Candidate={
  status:HealthStatus;
  score:number;
  reasons:string[];
  recommendedDailyLimit:number;
};

const rank:Record<HealthStatus,number>={healthy:0,watch:1,degraded:2,paused:3};
function worse(a:HealthStatus,b:HealthStatus){return rank[a]>=rank[b]?a:b}
function clamp(value:number,min:number,max:number){return Math.max(min,Math.min(max,value))}
function rate(numerator:number,denominator:number){return denominator>0?numerator/denominator:0}
function domainFromEmail(email:string){return email.split("@")[1]?.trim().toLowerCase()||""}

async function resolveTxtFlat(name:string){
  try{return (await dns.resolveTxt(name)).map(parts=>parts.join("")).filter(Boolean)}
  catch{return [] as string[]}
}
async function resolveCnames(name:string){
  try{return await dns.resolveCname(name)}
  catch{return [] as string[]}
}
async function hasDkimSelector(domain:string,selector:string){
  const name=`${selector}._domainkey.${domain}`;
  const [txt,cname]=await Promise.all([resolveTxtFlat(name),resolveCnames(name)]);
  return txt.some(value=>/v=DKIM1/i.test(value))||cname.length>0;
}
async function resolvePtrForHost(host:string){
  if(!host)return [] as string[];
  try{
    const ips=[...(await dns.resolve4(host).catch(()=>[])),...(await dns.resolve6(host).catch(()=>[]))];
    const ptrs:string[]=[];
    for(const ip of ips.slice(0,3)){
      try{ptrs.push(...await dns.reverse(ip))}catch{}
    }
    return [...new Set(ptrs.map(value=>value.toLowerCase()))];
  }catch{return []}
}

export async function inspectDomainDns(domain:string,smtpHost?:string):Promise<DomainDns>{
  const selectors=["key1","key2","selector1","selector2","google","default"];
  const [mx,rootTxt,dmarcTxt,selectorResults,ptrHosts]=await Promise.all([
    dns.resolveMx(domain).catch(()=>[]),
    resolveTxtFlat(domain),
    resolveTxtFlat(`_dmarc.${domain}`),
    Promise.all(selectors.map(async selector=>({selector,ok:await hasDkimSelector(domain,selector)}))),
    smtpHost?resolvePtrForHost(String(smtpHost)):Promise.resolve([] as string[]),
  ]);
  return {
    domain,
    mx:mx.length>0,
    spf:rootTxt.some(value=>/^v=spf1\b/i.test(value)),
    dkim:selectorResults.some(item=>item.ok),
    dmarc:dmarcTxt.some(value=>/^v=DMARC1\b/i.test(value)),
    ptr:smtpHost?ptrHosts.length>0:null,
    mxHosts:mx.sort((a,b)=>a.priority-b.priority).map(item=>item.exchange.replace(/\.$/,"")),
    dkimSelectors:selectorResults.filter(item=>item.ok).map(item=>item.selector),
    ptrHosts,
  };
}

async function smtpHealthy(credential:StoredMailboxCredential){
  if(credential.provider!=="smtp")return true;
  if(!credential.smtpHost||!credential.smtpUser||!credential.smtpPass)return false;
  const port=Number(credential.smtpPort||465);
  const transport=nodemailer.createTransport({
    host:credential.smtpHost,
    port,
    secure:port===465,
    auth:{user:credential.smtpUser,pass:credential.smtpPass},
    connectionTimeout:10_000,
    greetingTimeout:10_000,
    socketTimeout:12_000,
  });
  try{
    await transport.verify();
    return true;
  }catch{return false}
  finally{transport.close()}
}

async function mailboxConnectivity(credential:StoredMailboxCredential){
  if(credential.provider==="gmail"||credential.provider==="microsoft"){
    try{
      await getMailboxAccessToken(credential);
      return {smtp:true,imap:true};
    }catch{return {smtp:false,imap:false}}
  }
  const smtp=await smtpHealthy(credential);
  const imapCredential=credential as ImapMailboxCredential;
  if(!imapCredential.imapHost)return {smtp,imap:true};
  let imap=false;
  try{imap=await testImapConnection(imapCredential)}catch{imap=false}
  return {smtp,imap};
}

async function loadMailboxMetrics(mailboxId:string,workspace="default"):Promise<MailboxMetrics>{
  const [outbox]=await query<{sent24h:string;sent7d:string}>(
    `select
       count(*) filter(where status='sent' and sent_at>=now()-interval '24 hours')::text as "sent24h",
       count(*) filter(where status='sent' and sent_at>=now()-interval '7 days')::text as "sent7d"
     from er_outbox
     where workspace=$1 and mailbox_id=$2`,
    [workspace,mailboxId],
  );
  const [events]=await query<{attempts:string;deferred:string;failed:string;complaints:string}>(
    `select
       count(*) filter(where event_type='send_attempted')::text as attempts,
       count(*) filter(where event_type='send_deferred')::text as deferred,
       count(*) filter(where event_type='send_failed')::text as failed,
       count(*) filter(where event_type='complaint')::text as complaints
     from outbound_events
     where workspace=$1
       and occurred_at>=now()-interval '7 days'
       and payload->>'mailboxId'=$2`,
    [workspace,mailboxId],
  );
  const [bounce]=await query<{count:string}>(
    `select count(*)::text as count
     from er_events
     where workspace=$1
       and type='bounce'
       and created_at>=now()-interval '7 days'
       and meta->>'mailboxId'=$2`,
    [workspace,mailboxId],
  );
  const sent24h=Number(outbox?.sent24h||0);
  const sent7d=Number(outbox?.sent7d||0);
  const attempts7d=Number(events?.attempts||0);
  const deferred7d=Number(events?.deferred||0);
  const failed7d=Number(events?.failed||0);
  const bounces7d=Number(bounce?.count||0);
  const complaints7d=Number(events?.complaints||0);
  return {
    sent24h,sent7d,attempts7d,deferred7d,failed7d,bounces7d,complaints7d,
    bounceRate:rate(bounces7d,sent7d),
    complaintRate:rate(complaints7d,sent7d),
    deferralRate:rate(deferred7d,attempts7d),
    failureRate:rate(failed7d,attempts7d),
  };
}

async function loadDomainMetrics(mailboxIds:string[],workspace="default"):Promise<MailboxMetrics>{
  if(!mailboxIds.length)return {
    sent24h:0,sent7d:0,attempts7d:0,deferred7d:0,failed7d:0,bounces7d:0,complaints7d:0,
    bounceRate:0,complaintRate:0,deferralRate:0,failureRate:0,
  };
  const [outbox]=await query<{sent24h:string;sent7d:string}>(
    `select
       count(*) filter(where status='sent' and sent_at>=now()-interval '24 hours')::text as "sent24h",
       count(*) filter(where status='sent' and sent_at>=now()-interval '7 days')::text as "sent7d"
     from er_outbox
     where workspace=$1 and mailbox_id=any($2::text[])`,
    [workspace,mailboxIds],
  );
  const [events]=await query<{attempts:string;deferred:string;failed:string;complaints:string}>(
    `select
       count(*) filter(where event_type='send_attempted')::text as attempts,
       count(*) filter(where event_type='send_deferred')::text as deferred,
       count(*) filter(where event_type='send_failed')::text as failed,
       count(*) filter(where event_type='complaint')::text as complaints
     from outbound_events
     where workspace=$1
       and occurred_at>=now()-interval '7 days'
       and payload->>'mailboxId'=any($2::text[])`,
    [workspace,mailboxIds],
  );
  const [bounce]=await query<{count:string}>(
    `select count(*)::text as count
     from er_events
     where workspace=$1
       and type='bounce'
       and created_at>=now()-interval '7 days'
       and meta->>'mailboxId'=any($2::text[])`,
    [workspace,mailboxIds],
  );
  const sent24h=Number(outbox?.sent24h||0);
  const sent7d=Number(outbox?.sent7d||0);
  const attempts7d=Number(events?.attempts||0);
  const deferred7d=Number(events?.deferred||0);
  const failed7d=Number(events?.failed||0);
  const bounces7d=Number(bounce?.count||0);
  const complaints7d=Number(events?.complaints||0);
  return {
    sent24h,sent7d,attempts7d,deferred7d,failed7d,bounces7d,complaints7d,
    bounceRate:rate(bounces7d,sent7d),
    complaintRate:rate(complaints7d,sent7d),
    deferralRate:rate(deferred7d,attempts7d),
    failureRate:rate(failed7d,attempts7d),
  };
}

function evaluateRates(metrics:MailboxMetrics){
  let status:HealthStatus="healthy";
  let score=100;
  const reasons:string[]=[];

  if(metrics.sent7d>=20&&metrics.bounceRate>=0.05){
    status=worse(status,"paused");score-=55;reasons.push("bounce_rate_critical");
  }else if(metrics.sent7d>=20&&metrics.bounceRate>=0.02){
    status=worse(status,"degraded");score-=30;reasons.push("bounce_rate_high");
  }else if(metrics.bounces7d>0&&metrics.sent7d<20){
    status=worse(status,"watch");score-=10;reasons.push("bounce_small_sample");
  }

  if(metrics.complaints7d>0){
    if(metrics.sent7d>=100&&metrics.complaintRate>=0.003){
      status=worse(status,"paused");score-=60;reasons.push("complaint_rate_critical");
    }else{
      status=worse(status,"degraded");score-=35;reasons.push("complaint_detected");
    }
  }

  if(metrics.attempts7d>=10&&metrics.failureRate>=0.20){
    status=worse(status,"paused");score-=45;reasons.push("send_failure_rate_critical");
  }else if(metrics.attempts7d>=10&&metrics.failureRate>=0.10){
    status=worse(status,"degraded");score-=25;reasons.push("send_failure_rate_high");
  }

  if(metrics.attempts7d>=10&&metrics.deferralRate>=0.20){
    status=worse(status,"degraded");score-=25;reasons.push("deferral_rate_high");
  }else if(metrics.attempts7d>=10&&metrics.deferralRate>=0.10){
    status=worse(status,"watch");score-=10;reasons.push("deferral_rate_elevated");
  }

  return {status,score:clamp(score,0,100),reasons};
}

function evaluateDomain(dnsState:DomainDns,metrics:MailboxMetrics,baseDailyLimit:number):Candidate{
  const rateState=evaluateRates(metrics);
  let status=rateState.status;
  let score=rateState.score;
  const reasons=[...rateState.reasons];

  if(!dnsState.mx){status=worse(status,"paused");score-=60;reasons.push("mx_missing")}
  if(!dnsState.spf){status=worse(status,"degraded");score-=20;reasons.push("spf_missing")}
  if(!dnsState.dkim){status=worse(status,"degraded");score-=25;reasons.push("dkim_missing")}
  if(!dnsState.dmarc){status=worse(status,"degraded");score-=20;reasons.push("dmarc_missing")}
  if(dnsState.ptr===false){status=worse(status,"watch");score-=10;reasons.push("ptr_unverified")}

  const multiplier=status==="healthy"?1:status==="watch"?0.75:status==="degraded"?0.25:0;
  return {
    status,
    score:clamp(score,0,100),
    reasons,
    recommendedDailyLimit:status==="paused"?0:Math.max(1,Math.floor(baseDailyLimit*multiplier)),
  };
}

function evaluateMailbox(input:{
  dnsState:DomainDns;
  metrics:MailboxMetrics;
  smtp:boolean;
  imap:boolean;
  baseDailyLimit:number;
  domainStatus:HealthStatus;
}):Candidate{
  const rateState=evaluateRates(input.metrics);
  let status=worse(rateState.status,input.domainStatus);
  let score=rateState.score;
  const reasons=[...rateState.reasons];

  if(!input.smtp){status=worse(status,"paused");score-=60;reasons.push("smtp_unreachable")}
  if(!input.imap){status=worse(status,"paused");score-=45;reasons.push("imap_unreachable")}
  if(!input.dnsState.mx){reasons.push("domain_mx_missing")}
  if(!input.dnsState.spf){reasons.push("domain_spf_missing")}
  if(!input.dnsState.dkim){reasons.push("domain_dkim_missing")}
  if(!input.dnsState.dmarc){reasons.push("domain_dmarc_missing")}
  if(input.dnsState.ptr===false){reasons.push("domain_ptr_unverified")}

  if(input.domainStatus==="degraded")score-=15;
  if(input.domainStatus==="paused")score-=40;

  const multiplier=status==="healthy"?1:status==="watch"?0.75:status==="degraded"?0.25:0;
  return {
    status,
    score:clamp(score,0,100),
    reasons:[...new Set(reasons)],
    recommendedDailyLimit:status==="paused"?0:Math.max(1,Math.floor(input.baseDailyLimit*multiplier)),
  };
}

async function previousState(targetType:"mailbox"|"domain",targetId:string,workspace:string){
  const [row]=await query<SenderHealthStateRow>(
    `select target_type,target_id,health_status,health_score,base_daily_limit,recommended_daily_limit,
            enforced_daily_limit,paused_until,consecutive_healthy,consecutive_degraded,last_action,
            last_reason,metrics,reasons,observed_at
     from outbound_sender_health_state
     where workspace=$1 and target_type=$2 and target_id=$3
     limit 1`,
    [workspace,targetType,targetId],
  );
  return row;
}

function stabilizedCandidate(candidate:Candidate,previous:SenderHealthStateRow|undefined,baseDailyLimit:number){
  let status=candidate.status;
  let recommended=candidate.recommendedDailyLimit;
  const consecutiveHealthy=candidate.status==="healthy"?(previous?.consecutive_healthy||0)+1:0;
  const consecutiveDegraded=candidate.status==="healthy"?0:(previous?.consecutive_degraded||0)+1;

  if(candidate.status==="healthy"&&previous&&rank[previous.health_status]>=rank.degraded&&consecutiveHealthy<2){
    status="watch";
    recommended=Math.max(1,Math.floor(baseDailyLimit*0.5));
  }
  return {...candidate,status,recommendedDailyLimit:recommended,consecutiveHealthy,consecutiveDegraded};
}

async function persistHealth(input:{
  workspace:string;
  targetType:"mailbox"|"domain";
  targetId:string;
  domain:string;
  baseDailyLimit:number;
  candidate:Candidate;
  metrics:Record<string,unknown>;
  mode:"off"|"shadow"|"enforce";
}){
  const previous=await previousState(input.targetType,input.targetId,input.workspace);
  const stable=stabilizedCandidate(input.candidate,previous,input.baseDailyLimit);
  const enforced=input.mode==="enforce"?stable.recommendedDailyLimit:input.baseDailyLimit;
  const action=stable.status==="paused"
    ?(input.mode==="enforce"?"paused":"would_pause")
    :stable.recommendedDailyLimit<input.baseDailyLimit
      ?(input.mode==="enforce"?"capacity_reduced":"would_reduce")
      :(previous&&previous.recommended_daily_limit!==null&&previous.recommended_daily_limit<input.baseDailyLimit?"capacity_restored":"none");
  const pausedUntil=stable.status==="paused"?new Date(Date.now()+6*60*60*1000):null;
  const reason=stable.reasons[0]||null;

  await query(
    `insert into outbound_sender_health_snapshots(
       workspace,target_type,target_id,health_status,metrics,reasons,observed_at
     ) values($1,$2,$3,$4,$5::jsonb,$6::jsonb,now())`,
    [input.workspace,input.targetType,input.targetId,stable.status,JSON.stringify(input.metrics),JSON.stringify(stable.reasons)],
  );

  await query(
    `insert into outbound_sender_health_state(
       workspace,target_type,target_id,domain,health_status,health_score,
       base_daily_limit,recommended_daily_limit,enforced_daily_limit,paused_until,
       consecutive_healthy,consecutive_degraded,last_action,last_reason,policy_version,
       metrics,reasons,observed_at
     )
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,now())
     on conflict(workspace,target_type,target_id) do update
       set domain=excluded.domain,
           health_status=excluded.health_status,
           health_score=excluded.health_score,
           base_daily_limit=excluded.base_daily_limit,
           recommended_daily_limit=excluded.recommended_daily_limit,
           enforced_daily_limit=excluded.enforced_daily_limit,
           paused_until=excluded.paused_until,
           consecutive_healthy=excluded.consecutive_healthy,
           consecutive_degraded=excluded.consecutive_degraded,
           last_action=excluded.last_action,
           last_reason=excluded.last_reason,
           policy_version=excluded.policy_version,
           metrics=excluded.metrics,
           reasons=excluded.reasons,
           observed_at=excluded.observed_at`,
    [
      input.workspace,input.targetType,input.targetId,input.domain,stable.status,stable.score,
      input.baseDailyLimit,stable.recommendedDailyLimit,enforced,pausedUntil,
      stable.consecutiveHealthy,stable.consecutiveDegraded,action,reason,DELIVERABILITY_POLICY_VERSION,
      JSON.stringify(input.metrics),JSON.stringify(stable.reasons),
    ],
  );

  const changedStatus=previous?.health_status!==stable.status;
  const changedCapacity=previous?.recommended_daily_limit!==stable.recommendedDailyLimit;
  if(changedStatus||changedCapacity){
    const degraded=rank[stable.status]>=rank.degraded;
    const recovered=previous&&rank[previous.health_status]>=rank.degraded&&rank[stable.status]<rank.degraded;
    const eventType=input.targetType==="mailbox"
      ?stable.status==="paused"?"mailbox_paused":recovered?"mailbox_recovered":degraded?"mailbox_degraded":
        stable.recommendedDailyLimit<input.baseDailyLimit?"sender_capacity_reduced":"sender_capacity_restored"
      :recovered?"domain_recovered":degraded?"domain_degraded":"deliverability_snapshot";

    await recordOutboundEventByMode({
      workspace:input.workspace,
      type:eventType,
      actorType:"agent",
      actorId:"deliverability-control-tower",
      idempotencyKey:`deliverability:${input.targetType}:${input.targetId}:${stable.status}:${stable.recommendedDailyLimit}:${new Date().toISOString().slice(0,13)}`,
      payload:{
        targetType:input.targetType,
        targetId:input.targetId,
        domain:input.domain,
        mode:input.mode,
        previousStatus:previous?.health_status||null,
        healthStatus:stable.status,
        score:stable.score,
        baseDailyLimit:input.baseDailyLimit,
        recommendedDailyLimit:stable.recommendedDailyLimit,
        enforcedDailyLimit:enforced,
        action,
        reasons:stable.reasons,
        policyVersion:DELIVERABILITY_POLICY_VERSION,
      },
    });
  }

  return {
    targetType:input.targetType,
    targetId:input.targetId,
    domain:input.domain,
    healthStatus:stable.status,
    score:stable.score,
    baseDailyLimit:input.baseDailyLimit,
    recommendedDailyLimit:stable.recommendedDailyLimit,
    enforcedDailyLimit:enforced,
    action,
    reasons:stable.reasons,
  };
}

export async function runDeliverabilityHealthCheck(workspace="default"){
  const runtime=await resolveOutboundRuntimeConfig(workspace);
  if(runtime.deliverabilityMode==="off"){
    return {enabled:false,mode:"off",mailboxes:[],domains:[]};
  }

  const credentials=await loadMailboxCredentials();
  const state=(await readState().catch(()=>null))?.payload as StatePayload|undefined;
  const mailboxSettings=state?.mailboxes||[];
  const settingsByEmail=new Map(mailboxSettings.map(item=>[String(item.email||"").toLowerCase(),item]));
  const settingsById=new Map(mailboxSettings.map(item=>[item.id,item]));
  const settingFor=(credential:StoredMailboxCredential)=>
    settingsById.get(credential.id)||settingsByEmail.get(credential.email.toLowerCase());
  const baseLimitFor=(credential:StoredMailboxCredential)=>
    clamp(Number(settingFor(credential)?.dailyLimit||5),1,100);
  const activeCredentials=credentials.filter(credential=>settingFor(credential)?.enabled!==false);

  const groups=new Map<string,StoredMailboxCredential[]>();
  for(const credential of activeCredentials){
    const domain=domainFromEmail(credential.email);
    if(!domain)continue;
    const current=groups.get(domain)||[];
    current.push(credential);
    groups.set(domain,current);
  }

  const domainResults=[];
  const domainStatus=new Map<string,{status:HealthStatus;dns:DomainDns}>();
  for(const [domain,mailboxes] of groups){
    const smtpHost=mailboxes.find(item=>item.smtpHost)?.smtpHost||"";
    const dnsState=await inspectDomainDns(domain,smtpHost);
    const metrics=await loadDomainMetrics(mailboxes.map(item=>item.id),workspace);
    const baseLimit=mailboxes.reduce((sum,item)=>sum+baseLimitFor(item),0);
    const candidate=evaluateDomain(dnsState,metrics,baseLimit);
    const result=await persistHealth({
      workspace,
      targetType:"domain",
      targetId:domain,
      domain,
      baseDailyLimit:baseLimit,
      candidate,
      metrics:{...metrics,dns:dnsState},
      mode:runtime.deliverabilityMode,
    });
    domainStatus.set(domain,{status:result.healthStatus,dns:dnsState});
    domainResults.push(result);
  }

  const mailboxResults=[];
  for(const credential of activeCredentials){
    const domain=domainFromEmail(credential.email);
    if(!domain)continue;
    const domainHealth=domainStatus.get(domain);
    if(!domainHealth)continue;
    const [metrics,connectivity]=await Promise.all([
      loadMailboxMetrics(credential.id,workspace),
      mailboxConnectivity(credential),
    ]);
    const baseDailyLimit=baseLimitFor(credential);
    const candidate=evaluateMailbox({
      dnsState:domainHealth.dns,
      metrics,
      smtp:connectivity.smtp,
      imap:connectivity.imap,
      baseDailyLimit,
      domainStatus:domainHealth.status,
    });
    mailboxResults.push(await persistHealth({
      workspace,
      targetType:"mailbox",
      targetId:credential.id,
      domain,
      baseDailyLimit,
      candidate,
      metrics:{...metrics,connectivity,email:credential.email},
      mode:runtime.deliverabilityMode,
    }));
  }

  return {
    enabled:true,
    mode:runtime.deliverabilityMode,
    policyVersion:DELIVERABILITY_POLICY_VERSION,
    domains:domainResults,
    mailboxes:mailboxResults,
  };
}

export async function getMailboxHealthMap(workspace="default"){
  const rows=await query<SenderHealthStateRow&{domain:string|null}>(
    `select target_type,target_id,domain,health_status,health_score,base_daily_limit,
            recommended_daily_limit,enforced_daily_limit,paused_until,consecutive_healthy,
            consecutive_degraded,last_action,last_reason,metrics,reasons,observed_at
     from outbound_sender_health_state
     where workspace=$1 and target_type='mailbox'`,
    [workspace],
  );
  return new Map(rows.map(row=>[row.target_id,row]));
}
