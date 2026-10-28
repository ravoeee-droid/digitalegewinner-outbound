import { createHmac, timingSafeEqual } from "node:crypto";

function secret(){
  const value=process.env.EMAIL_TRACKING_SECRET||process.env.CRON_SECRET||"";
  if(!value)throw new Error("E-Mail Tracking Secret fehlt.");
  return value;
}
function signature(value:string){return createHmac("sha256",secret()).update(value).digest("base64url");}
function safeEqual(a:string,b:string){
  try{const aa=Buffer.from(a);const bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);}
  catch{return false}
}
function base(origin:string){return origin.replace(/\/$/,"");}
function openValue(outboxId:string,leadId:string){return `open|${outboxId}|${leadId}`;}
function unsubValue(outboxId:string,leadId:string){return `unsub|${outboxId}|${leadId}`;}
function clickValue(outboxId:string,leadId:string,target:string){return `click|${outboxId}|${leadId}|${target}`;}
export function openTrackingUrl(origin:string,outboxId:string,leadId:string){
  const sig=signature(openValue(outboxId,leadId));
  return `${base(origin)}/api/t/open?o=${encodeURIComponent(outboxId)}&l=${encodeURIComponent(leadId)}&s=${encodeURIComponent(sig)}`;
}
export function clickTrackingUrl(origin:string,outboxId:string,leadId:string,target:string){
  const encoded=Buffer.from(target).toString("base64url");
  const sig=signature(clickValue(outboxId,leadId,encoded));
  return `${base(origin)}/api/t/click?o=${encodeURIComponent(outboxId)}&l=${encodeURIComponent(leadId)}&u=${encodeURIComponent(encoded)}&s=${encodeURIComponent(sig)}`;
}
export function unsubscribeUrl(origin:string,outboxId:string,leadId:string){
  const sig=signature(unsubValue(outboxId,leadId));
  return `${base(origin)}/api/t/unsub?o=${encodeURIComponent(outboxId)}&l=${encodeURIComponent(leadId)}&s=${encodeURIComponent(sig)}`;
}
export function verifyUnsubscribe(outboxId:string,leadId:string,sig:string){return safeEqual(signature(unsubValue(outboxId,leadId)),sig);}
export function verifyOpen(outboxId:string,leadId:string,sig:string){return safeEqual(signature(openValue(outboxId,leadId)),sig);}
export function verifyClick(outboxId:string,leadId:string,encodedTarget:string,sig:string){
  return safeEqual(signature(clickValue(outboxId,leadId,encodedTarget)),sig);
}
export function decodeTarget(encoded:string){
  try{
    const value=Buffer.from(encoded,"base64url").toString("utf8");
    const url=new URL(value);
    return ["http:","https:"].includes(url.protocol)?url.toString():"";
  }catch{return ""}
}
function escapeHtml(value:string){
  return value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}
export function trackedEmailHtml(text:string,origin:string,outboxId:string,leadId:string,unsubscribe?:string){
  const url=/https?:\/\/[^\s<>"']+/g;
  let cursor=0;let html="";
  for(const match of text.matchAll(url)){
    const index=match.index??0;
    html+=escapeHtml(text.slice(cursor,index)).replace(/\n/g,"<br>");
    const target=match[0];
    const href=escapeHtml(clickTrackingUrl(origin,outboxId,leadId,target));
    // Replace only this lead's signed personal video URL with a clear email-safe CTA.
    // Keep the original tracked destination and preserve all other links as text.
    if(target===videoPageUrl(origin,leadId)) {
      // An actual JPG thumbnail works in Gmail/Outlook; the picture and CTA share the same tracked video destination.
      const imageSrc=escapeHtml(`${base(origin)}/api/t/preview/${encodeURIComponent(videoToken(leadId))}`);
      html+=`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:16px 0 20px;width:100%;max-width:520px"><tr><td><a href="${href}" style="display:block;text-decoration:none" aria-label="Persönliches Video ansehen"><img src="${imageSrc}" width="520" height="293" alt="Videovorschau: Ihre Website mit Raphaels Videonachricht – jetzt ansehen" style="display:block;width:100%;max-width:520px;height:auto;border:0;border-radius:9px" /></a></td></tr><tr><td style="padding-top:12px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#ec6500" style="background-color:#ec6500;border-radius:8px;text-align:center"><a href="${href}" style="display:inline-block;padding:15px 24px;border-radius:8px;background-color:#ec6500;color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:700;line-height:22px;text-decoration:none">▶ Persönliches Video ansehen</a></td></tr></table></td></tr></table>`;
    } else {
      html+=`<a href="${href}">${escapeHtml(target)}</a>`;
    }
    cursor=index+target.length;
  }
  html+=escapeHtml(text.slice(cursor)).replace(/\n/g,"<br>");
  if(unsubscribe)html+=`<br><br><span style="font-size:12px;color:#666">Kein Interesse an weiteren Nachrichten? <a href="${escapeHtml(unsubscribe)}" style="color:#666">Hier abmelden</a>.</span>`;
  const pixel=openTrackingUrl(origin,outboxId,leadId);
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#111">${html}<img src="${escapeHtml(pixel)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:.01" /></div>`;
}

// Persönlicher Link zur Videoseite: Lead-ID plus kurze Signatur, damit niemand fremde Lead-IDs raten kann.
export function videoToken(leadId:string){return `${leadId}.${signature(`video|${leadId}`).slice(0,16)}`;}
export function verifyVideoToken(token:string){
  const index=token.lastIndexOf(".");
  if(index<1)return "";
  const leadId=token.slice(0,index);
  return safeEqual(videoToken(leadId),token)?leadId:"";
}
export function videoPageUrl(origin:string,leadId:string){return `${base(origin)}/v/${encodeURIComponent(videoToken(leadId))}`;}
