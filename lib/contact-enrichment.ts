import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type ContactEnrichment={
  email:string;
  emails:string[];
  phone:string;
  phones:string[];
  linkedin:string;
  instagram:string;
  contactPage:string;
  pagesScanned:number;
  source:"public-website";
};

const MAX_BYTES=1_500_000;
const MAX_PAGES=4;
const MAX_REDIRECTS=4;

function privateIp(ip:string){
 const value=ip.toLowerCase();
 if(isIP(ip)===4){const [a,b]=ip.split(".").map(Number);return a===10||a===127||a===0||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||a>=224}
 if(isIP(ip)===6)return value==="::1"||value==="::"||value.startsWith("fe80:")||value.startsWith("fc")||value.startsWith("fd");
 return true;
}
function siteHost(host:string){return host.toLowerCase().replace(/^www\./,"")}
function sameSite(a:string,b:string){return siteHost(a)===siteHost(b)}
async function safeUrl(url:URL){
 if(!["http:","https:"].includes(url.protocol)||url.username||url.password)throw new Error("Ungültige Website-URL.");
 const host=url.hostname.toLowerCase();if(host==="localhost"||host.endsWith(".local")||host.endsWith(".internal"))throw new Error("Interne Hosts sind nicht erlaubt.");
 if(isIP(host)&&privateIp(host))throw new Error("Private Zieladresse ist nicht erlaubt.");
 const addresses=await lookup(host,{all:true,verbatim:true});if(!addresses.length||addresses.some(entry=>privateIp(entry.address)))throw new Error("Website ist nicht öffentlich erreichbar.");
}
function normalize(raw:string){const value=raw.trim();if(!value)throw new Error("Website fehlt.");return new URL(/^https?:\/\//i.test(value)?value:`https://${value}`)}
function decode(value:string){return value.replace(/&amp;/gi,"&").replace(/&#64;|&#x40;/gi,"@").replace(/\s+/g," ")}
function unique(values:string[]){return [...new Set(values.filter(Boolean))]}
function emailScore(email:string){const local=email.split("@")[0].toLowerCase();const preferred=["info","kontakt","contact","hello","office","sales","vertrieb","anfrage","mail","team","service"];const bad=["noreply","no-reply","privacy","datenschutz","abuse","webmaster"];if(bad.some(x=>local.includes(x)))return -20;const preferredIndex=preferred.findIndex(x=>local===x||local.startsWith(`${x}.`)||local.startsWith(`${x}-`));return preferredIndex>=0?50-preferredIndex:10}
function extract(html:string,base:URL){
 const decoded=decode(html);
 const mailtos=[...decoded.matchAll(/href\s*=\s*["']mailto:([^"'?\s>]+)/gi)].map(m=>m[1].trim().toLowerCase());
 const plain=[...decoded.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}\b/gi)].map(m=>m[0].toLowerCase());
 const emails=unique([...mailtos,...plain]).filter(email=>!email.endsWith("@example.com")&&!/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(email));
 const telLinks=[...decoded.matchAll(/href\s*=\s*["']tel:([^"']+)/gi)].map(m=>m[1].replace(/[^+\d]/g,""));
 const phones=unique(telLinks.filter(phone=>phone.replace(/\D/g,"").length>=7));
 let linkedin="",instagram="";for(const match of decoded.matchAll(/href\s*=\s*["']([^"']+)["']/gi)){const href=match[1];try{if(!linkedin&&/linkedin\.com\//i.test(href))linkedin=new URL(href,base).toString();if(!instagram&&/instagram\.com\//i.test(href))instagram=new URL(href,base).toString()}catch{}}
 const pageLinks:string[]=[];for(const match of decoded.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){const href=match[1];const label=match[2].replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();if(/kontakt|contact|impressum|imprint|about|über uns|unternehmen/i.test(`${href} ${label}`)){try{const candidate=new URL(href,base);if(sameSite(candidate.hostname,base.hostname)&&["http:","https:"].includes(candidate.protocol))pageLinks.push(candidate.toString())}catch{}}}
 return{emails,phones,linkedin,instagram,pageLinks:unique(pageLinks)};
}
async function getHtml(input:URL){let url=new URL(input);for(let redirects=0;redirects<=MAX_REDIRECTS;redirects++){await safeUrl(url);const response=await fetch(url,{redirect:"manual",cache:"no-store",headers:{"user-agent":"DigitaleGewinner-ContactEnrichment/1.0",accept:"text/html,application/xhtml+xml"},signal:AbortSignal.timeout(9000)});if([301,302,303,307,308].includes(response.status)){const location=response.headers.get("location");if(!location)throw new Error("Weiterleitung ohne Ziel.");url=new URL(location,url);continue}if(!response.ok)throw new Error(`Website HTTP ${response.status}`);const type=response.headers.get("content-type")||"";if(!type.includes("text/html")&&!type.includes("application/xhtml+xml"))throw new Error("Keine HTML-Seite.");const declared=Number(response.headers.get("content-length")||0);if(declared>MAX_BYTES)throw new Error("Website zu groß.");const bytes=await response.arrayBuffer();if(bytes.byteLength>MAX_BYTES)throw new Error("Website zu groß.");return{html:new TextDecoder().decode(bytes),url}}throw new Error("Zu viele Weiterleitungen.")}

export async function enrichPublicContact(rawUrl:string):Promise<ContactEnrichment>{
 const start=normalize(rawUrl);const first=await getHtml(start);const root=first.url;const queue=[root.toString()];const prefetched=new Map([[root.toString(),first.html]]);const visited=new Set<string>();let emails:string[]=[],phones:string[]=[],linkedin="",instagram="",contactPage="";
 while(queue.length&&visited.size<MAX_PAGES){const raw=queue.shift()!;if(visited.has(raw))continue;visited.add(raw);try{const url=new URL(raw);if(!sameSite(url.hostname,root.hostname))continue;const pageHtml=prefetched.get(raw);const page=pageHtml!==undefined?{html:pageHtml,url}:await getHtml(url);if(!sameSite(page.url.hostname,root.hostname))continue;const found=extract(page.html,page.url);emails=unique([...emails,...found.emails]);phones=unique([...phones,...found.phones]);linkedin=linkedin||found.linkedin;instagram=instagram||found.instagram;if(raw!==root.toString()&&!contactPage)contactPage=raw;for(const link of found.pageLinks){if(!visited.has(link)&&queue.length+visited.size<MAX_PAGES+2)queue.push(link)}}catch{}}
 emails.sort((a,b)=>emailScore(b)-emailScore(a));
 return{email:emails[0]||"",emails:emails.slice(0,8),phone:phones[0]||"",phones:phones.slice(0,8),linkedin,instagram,contactPage,pagesScanned:visited.size,source:"public-website"};
}
