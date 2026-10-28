// Virtual MP4 faststart: put the original moov index before mdat without
// copying/transcoding 300-MB video assets. Every response is a small HTTP Range.
// Chunk offsets inside moov are shifted to match the virtual byte layout.
type Part = { data?: Buffer; start?: number; end?: number };
export type Faststart = {
  size: number; prefix: number; moovStart: number; moov: Buffer;
  patchedOffsets: number;
};
const CACHE = new Map<string,Promise<Faststart|null>>();

async function readRange(url:string,token:string,start:number,end:number) {
  const response=await fetch(url,{
    headers:{authorization:`Bearer ${token}`,range:`bytes=${start}-${end}`},
    cache:"no-store",signal:AbortSignal.timeout(15000)
  });
  if(response.status!==206)throw new Error("Blob did not honor Range: "+response.status);
  return Buffer.from(await response.arrayBuffer());
}

function patchOffsets(moov:Buffer,shift:number,mdatStart:number,moovStart:number){
  let changed=0;
  for(let i=4;i<moov.length-16;i++){
    const tag=moov.toString("ascii",i,i+4);
    if(tag!=="stco" && tag!=="co64")continue;
    const boxStart=i-4;
    const boxSize=moov.readUInt32BE(boxStart);
    const is64=tag==="co64";
    const step=is64?8:4;
    if(boxSize<16||boxStart+boxSize>moov.length)continue;
    const count=moov.readUInt32BE(i+8);
    const entries=i+12;
    if(count>1_000_000||entries+count*step>boxStart+boxSize)continue;
    let valid=true;
    for(let j=0;j<count;j++){
      const offset=is64?Number(moov.readBigUInt64BE(entries+j*step)):moov.readUInt32BE(entries+j*step);
      if(offset<mdatStart||offset>=moovStart||!Number.isSafeInteger(offset+shift)||( !is64 && offset+shift>0xffffffff)) {
        valid=false;break;
      }
    }
    if(!valid)continue;
    for(let j=0;j<count;j++){
      const index=entries+j*step;
      if(is64)moov.writeBigUInt64BE(moov.readBigUInt64BE(index)+BigInt(shift),index);
      else moov.writeUInt32BE(moov.readUInt32BE(index)+shift,index);
      changed++;
    }
    i=boxStart+boxSize-1;
  }
  return changed;
}

export async function prepareFaststart(url:string,token:string,size:number):Promise<Faststart|null>{
  if(CACHE.has(url))return CACHE.get(url)!;
  const work=(async()=>{
    const [head,tail]=await Promise.all([
      readRange(url,token,0,Math.min(size-1,4095)),
      readRange(url,token,Math.max(0,size-524288),size-1)
    ]);
    const prefixTag=head.indexOf(Buffer.from("mdat"));
    const prefix=prefixTag-4;
    if(prefix<8||prefix>4090)throw new Error("mdat atom not in first 4KB");
    const tailBase=Math.max(0,size-524288);
    let found=-1,moovSize=0;
    for(let i=4;i+4<tail.length;i++){
      if(tail.toString("ascii",i,i+4)!=="moov")continue;
      const atomSize=tail.readUInt32BE(i-4);
      if(atomSize>=64 && tailBase+i-4+atomSize===size){
        found=i-4;moovSize=atomSize;break;
      }
    }
    if(found<0)throw new Error("moov atom not found as final top-level atom");
    const moovStart=tailBase+found;
    const moov=Buffer.from(tail.subarray(found,found+moovSize));
    if(moov.length!==moovSize)throw new Error("moov atom incomplete");
    const patchedOffsets=patchOffsets(moov,moovSize,prefix,moovStart);
    if(patchedOffsets===0)throw new Error("No stco/co64 offsets patched");
    console.info("[loom-faststart] index relocated",{prefix,moovStart,moovSize,patchedOffsets});
    return {size,prefix,moovStart,moov,patchedOffsets};
  })().catch(error=>{
    console.error("[loom-faststart] cannot relocate index",error instanceof Error?error.message:String(error));
    return null;
  });
  CACHE.set(url,work);
  return work;
}

export function virtualParts(meta:Faststart,start:number,end:number):Part[]{
  const a=meta.prefix,b=meta.prefix+meta.moov.length,c=meta.moovStart+meta.moov.length;
  const regions=[
    {from:0,to:a-1,source:0},
    {from:a,to:b-1,buffer:meta.moov},
    {from:b,to:c-1,source:a}
  ];
  const parts:Part[]=[];
  for(const r of regions){
    const from=Math.max(start,r.from),to=Math.min(end,r.to);
    if(from>to)continue;
    if("buffer" in r && r.buffer)parts.push({data:r.buffer.subarray(from-r.from,to-r.from+1)});
    else if(r.source!==undefined)parts.push({start:r.source+from-r.from,end:r.source+to-r.from});
  }
  return parts;
}

export function parseRange(raw:string|null,size:number,maxBytes=4*1024*1024) {
  if(!raw)return {start:0,end:Math.min(size-1,maxBytes-1)};
  const match=/^bytes=(\d*)-(\d*)$/.exec(raw);
  if(!match) return null;
  let start=match[1]?Number(match[1]):0;
  let end=match[2]?Number(match[2]):size-1;
  if(!match[1] && match[2]){start=Math.max(0,size-Number(match[2]));end=size-1;}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||start>end||start<0)return null;
  return {start,end:Math.min(end,start+maxBytes-1)};
}

export function streamVirtualParts(
  url:string, token:string, parts:Part[], requestSignal:AbortSignal
) {
  const aborted=new AbortController();
  requestSignal.addEventListener("abort",()=>aborted.abort(),{once:true});
  return new ReadableStream<Uint8Array>({
    async start(controller){
      try{
        for(const part of parts){
          if(aborted.signal.aborted)break;
          if(part.data){controller.enqueue(new Uint8Array(part.data));continue;}
          if(part.start===undefined||part.end===undefined)continue;
          const response=await fetch(url,{
            headers:{authorization:`Bearer ${token}`,range:`bytes=${part.start}-${part.end}`},
            cache:"no-store",signal:aborted.signal
          });
          console.info("[loom-faststart] upstream chunk",{start:part.start,end:part.end,status:response.status,length:response.headers.get("content-length")});
          if(response.status!==206||!response.body)throw new Error("Streaming Range failed: "+response.status);
          const reader=response.body.getReader();
          while(true){
            const next=await reader.read();
            if(next.done)break;
            controller.enqueue(next.value);
          }
        }
        if(!aborted.signal.aborted)controller.close();
      }catch(err){console.error("[loom-faststart] stream failure",err instanceof Error?err.message:String(err));if(!aborted.signal.aborted)controller.error(err);}
    },
    cancel(){aborted.abort();}
  });
}
