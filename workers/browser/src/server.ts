import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { z } from "zod";

const PORT=Number(process.env.PORT||8787);
const HOST=process.env.HOST||"0.0.0.0";
const SECRET=process.env.BROWSER_WORKER_SECRET||"";
const ASSET_DIR=resolve(process.env.ASSET_DIR||join(process.cwd(),".assets"));
const PUBLIC_BASE=(process.env.ASSET_PUBLIC_BASE_URL||`http://localhost:${PORT}`).replace(/\/$/,"");
const MAX_CONCURRENCY=Math.max(1,Math.min(4,Number(process.env.MAX_CONCURRENCY||2)));
const NAV_TIMEOUT=Math.max(5_000,Math.min(30_000,Number(process.env.NAV_TIMEOUT_MS||18_000)));
const MAX_BODY_BYTES=512_000;

const targetSchema=z.object({kind:z.enum(["website","instagram","youtube"]),url:z.string().url()});
const sceneSchema=z.object({start:z.number().min(0).max(300),end:z.number().min(0).max(300),source:z.string().max(30),url:z.string().url().optional(),visual:z.string().max(1000),voiceover:z.string().max(2000)});
const captureSchema=z.object({leadId:z.string().min(1).max(200),company:z.string().min(2).max(200),targets:z.array(targetSchema).min(1).max(3),scenes:z.array(sceneSchema).max(12).default([]),recordVideo:z.boolean().default(true)});

type CaptureInput=z.infer<typeof captureSchema>;
type ScreencastApi={start:(options:{path:string})=>Promise<void>;stop:()=>Promise<void>};

let browserPromise:Promise<Browser>|null=null;
let activeJobs=0;
mkdirSync(ASSET_DIR,{recursive:true});

function safeId(value:string){return value.replace(/[^a-zA-Z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,120)||"lead"}
function json(response:ServerResponse,status:number,payload:unknown){const body=JSON.stringify(payload);response.writeHead(status,{"content-type":"application/json; charset=utf-8","content-length":Buffer.byteLength(body),"cache-control":"no-store"});response.end(body)}
function authorized(request:IncomingMessage){if(!SECRET)return false;return (request.headers.authorization||"")===`Bearer ${SECRET}`}
function isPrivateIp(ip:string){
  const normalized=ip.toLowerCase();
  if(isIP(ip)===4){const [a,b]=ip.split(".").map(Number);return a===10||a===127||a===0||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||a>=224}
  if(isIP(ip)===6)return normalized==="::1"||normalized==="::"||normalized.startsWith("fe80:")||normalized.startsWith("fc")||normalized.startsWith("fd");
  return true;
}
async function assertPublicUrl(raw:string){
  const url=new URL(raw);
  if(!["http:","https:"].includes(url.protocol))throw new Error("Only HTTP/HTTPS targets are allowed.");
  if(url.username||url.password)throw new Error("Credentialed URLs are not allowed.");
  const host=url.hostname.toLowerCase();
  if(host==="localhost"||host.endsWith(".local")||host.endsWith(".internal"))throw new Error("Private hosts are blocked.");
  if(isIP(host)&&isPrivateIp(host))throw new Error("Private IP targets are blocked.");
  const addresses=await lookup(host,{all:true,verbatim:true});
  if(!addresses.length||addresses.some((entry)=>isPrivateIp(entry.address)))throw new Error("Target must resolve to public IPs only.");
  return url;
}
function blockObviouslyPrivateRequest(raw:string){
  try{
    const url=new URL(raw);
    if(!["http:","https:"].includes(url.protocol))return false;
    const host=url.hostname.toLowerCase();
    return host==="localhost"||host.endsWith(".local")||host.endsWith(".internal")||(isIP(host)>0&&isPrivateIp(host));
  }catch{return true}
}
async function readBody(request:IncomingMessage){
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of request){const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=buffer.length;if(size>MAX_BODY_BYTES)throw new Error("Request body too large.");chunks.push(buffer)}
  return Buffer.concat(chunks).toString("utf8");
}
async function browser(){
  if(!browserPromise)browserPromise=chromium.launch({headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
  return browserPromise;
}
async function newContext(){
  const instance=await browser();
  const context=await instance.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,colorScheme:"light",locale:"de-DE",timezoneId:"Europe/Berlin",userAgent:"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"});
  await context.route("**/*",async(route)=>{if(blockObviouslyPrivateRequest(route.request().url()))await route.abort("blockedbyclient");else await route.continue()});
  return context;
}
async function dismissConsent(page:Page){
  const labels=["Alle akzeptieren","Akzeptieren","Zustimmen","Accept all","Allow all","I agree","Nur notwendige","Essential only"];
  for(const text of labels){try{const button=page.getByRole("button",{name:text,exact:false}).first();if(await button.isVisible({timeout:250})){await button.click({timeout:800});return}}catch{}}
}
async function settle(page:Page){
  await page.waitForTimeout(900);
  await dismissConsent(page);
  await page.waitForTimeout(500);
}
async function navigate(page:Page,raw:string){
  await assertPublicUrl(raw);
  const response=await page.goto(raw,{waitUntil:"domcontentloaded",timeout:NAV_TIMEOUT});
  const finalUrl=page.url();
  await assertPublicUrl(finalUrl);
  if(response&&response.status()>=500)throw new Error(`Target returned HTTP ${response.status()}`);
  await settle(page);
}
function contentType(path:string){const extension=extname(path).toLowerCase();return extension===".png"?"image/png":extension===".webm"?"video/webm":extension===".jpg"||extension===".jpeg"?"image/jpeg":"application/octet-stream"}
async function persist(localPath:string,key:string,mime:string){
  const supabaseUrl=(process.env.SUPABASE_URL||"").replace(/\/$/,"");
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
  const bucket=process.env.SUPABASE_STORAGE_BUCKET||"";
  if(supabaseUrl&&serviceKey&&bucket){
    const bytes=await readFile(localPath);
    const encodedKey=key.split("/").map(encodeURIComponent).join("/");
    const upload=await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedKey}`,{method:"POST",headers:{authorization:`Bearer ${serviceKey}`,apikey:serviceKey,"content-type":mime,"x-upsert":"true"},body:bytes});
    if(!upload.ok)throw new Error(`Supabase Storage upload failed: ${upload.status}`);
    return `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodedKey}`;
  }
  return `${PUBLIC_BASE}/assets/${key.split("/").map(encodeURIComponent).join("/")}`;
}
async function captureTarget(context:BrowserContext,target:CaptureInput["targets"][number],folder:string,keyPrefix:string){
  const page=await context.newPage();
  try{
    await navigate(page,target.url);
    if(target.kind==="website"){await page.mouse.wheel(0,320);await page.waitForTimeout(250)}
    const file=join(folder,`${target.kind}.png`);
    await page.screenshot({path:file,fullPage:false,animations:"disabled",caret:"hide"});
    return await persist(file,`${keyPrefix}/${target.kind}.png`,"image/png");
  }finally{await page.close().catch(()=>undefined)}
}
async function recordJourney(input:CaptureInput,folder:string,keyPrefix:string){
  const context=await newContext();
  const page=await context.newPage();
  const file=join(folder,"loom-browser.webm");
  let recording=false;
  try{
    const screencast=(page as unknown as {screencast?:ScreencastApi}).screencast;
    if(!screencast)return "";
    await screencast.start({path:file});recording=true;
    for(const target of input.targets.slice(0,3)){
      try{
        await navigate(page,target.url);
        await page.waitForTimeout(900);
        await page.mouse.move(1100,420,{steps:12});
        await page.mouse.wheel(0,650);
        await page.waitForTimeout(900);
      }catch{}
    }
    await screencast.stop();recording=false;
    return existsSync(file)?await persist(file,`${keyPrefix}/loom-browser.webm`,"video/webm"):"";
  }finally{
    if(recording){try{await (page as unknown as {screencast:ScreencastApi}).screencast.stop()}catch{}}
    await context.close().catch(()=>undefined);
  }
}
async function capture(input:CaptureInput){
  const id=safeId(input.leadId);
  const folder=join(ASSET_DIR,"jj-media",id);
  mkdirSync(folder,{recursive:true});
  const keyPrefix=`jj-media/${id}`;
  const context=await newContext();
  const assets:Record<string,string>={};
  const errors:string[]=[];
  try{
    for(const target of input.targets){
      try{assets[target.kind]=await captureTarget(context,target,folder,keyPrefix)}catch(error){errors.push(`${target.kind}: ${error instanceof Error?error.message:"capture failed"}`)}
    }
  }finally{await context.close().catch(()=>undefined)}
  if(input.recordVideo){try{const video=await recordJourney(input,folder,keyPrefix);if(video)assets.loomVideo=video}catch(error){errors.push(`loomVideo: ${error instanceof Error?error.message:"recording failed"}`)}}
  if(!assets.website&&!assets.instagram&&!assets.youtube)throw new Error(errors[0]||"No capture could be created.");
  return{status:"ready",assets,errors};
}
function staticPath(urlPath:string){
  const relative=decodeURIComponent(urlPath.slice("/assets/".length));
  const candidate=resolve(ASSET_DIR,normalize(relative));
  return candidate.startsWith(`${ASSET_DIR}/`)||candidate===ASSET_DIR?candidate:"";
}
function serveAsset(request:IncomingMessage,response:ServerResponse,urlPath:string){
  const file=staticPath(urlPath);
  if(!file||!existsSync(file)||!statSync(file).isFile()){response.writeHead(404);response.end("Not found");return}
  const stat=statSync(file);const type=contentType(file);const range=request.headers.range;
  response.setHeader("accept-ranges","bytes");response.setHeader("cache-control","public, max-age=31536000, immutable");response.setHeader("content-type",type);
  if(range){const match=/bytes=(\d*)-(\d*)/.exec(range);if(match){const start=match[1]?Number(match[1]):0;const end=match[2]?Number(match[2]):stat.size-1;if(Number.isFinite(start)&&Number.isFinite(end)&&start<=end&&end<stat.size){response.writeHead(206,{"content-range":`bytes ${start}-${end}/${stat.size}`,"content-length":end-start+1});createReadStream(file,{start,end}).pipe(response);return}}response.writeHead(416,{"content-range":`bytes */${stat.size}`});response.end();return}
  response.writeHead(200,{"content-length":stat.size});createReadStream(file).pipe(response);
}

const server=createServer(async(request,response)=>{
  const url=new URL(request.url||"/",`http://${request.headers.host||"localhost"}`);
  if(request.method==="GET"&&url.pathname==="/health"){json(response,200,{ok:true,activeJobs,maxConcurrency:MAX_CONCURRENCY});return}
  if(request.method==="GET"&&url.pathname.startsWith("/assets/")){serveAsset(request,response,url.pathname);return}
  if(request.method!=="POST"||url.pathname!=="/v1/capture"){json(response,404,{error:"Not found"});return}
  if(!authorized(request)){json(response,401,{error:"Unauthorized"});return}
  if(activeJobs>=MAX_CONCURRENCY){json(response,429,{error:"Worker capacity reached. Retry shortly."});return}
  activeJobs+=1;
  try{
    const raw=await readBody(request);
    const input=captureSchema.parse(JSON.parse(raw));
    for(const target of input.targets)await assertPublicUrl(target.url);
    const result=await capture(input);
    json(response,200,result);
  }catch(error){json(response,400,{error:error instanceof Error?error.message:"Capture failed"})}
  finally{activeJobs-=1}
});

server.listen(PORT,HOST,()=>{console.log(`JJ-Media browser worker listening on http://${HOST}:${PORT}`)});

async function shutdown(){
  server.close();
  const instance=browserPromise?await browserPromise.catch(()=>null):null;
  await instance?.close().catch(()=>undefined);
  process.exit(0);
}
process.once("SIGTERM",()=>void shutdown());
process.once("SIGINT",()=>void shutdown());
