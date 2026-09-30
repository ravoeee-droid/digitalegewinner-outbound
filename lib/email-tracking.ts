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
export function trackedEmailHtml(text:string,origin:string,outboxId:string,leadId:string){
  const url=/https?:\/\/[^\s<>"']+/g;
  let cursor=0;let html="";
  for(const match of text.matchAll(url)){
    const index=match.index??0;
    html+=escapeHtml(text.slice(cursor,index)).replace(/\n/g,"<br>");
    const target=match[0];
    html+=`<a href="${escapeHtml(clickTrackingUrl(origin,outboxId,leadId,target))}">${escapeHtml(target)}</a>`;
    cursor=index+target.length;
  }
  html+=escapeHtml(text.slice(cursor)).replace(/\n/g,"<br>");
  const pixel=openTrackingUrl(origin,outboxId,leadId);
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#111">${html}<img src="${escapeHtml(pixel)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:.01" /></div>`;
}
