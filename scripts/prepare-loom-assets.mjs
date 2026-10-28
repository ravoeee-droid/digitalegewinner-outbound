import { get } from "@vercel/blob";
import { mkdir, stat, writeFile, rename, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

// The MP4s live in the user's private Vercel Blob store. During BUILD only,
// download compact, faststart-encoded derivatives into the deployment's public
// folder so browsers can stream via the edge CDN, without any function proxy.
// Source files are ~10 MB each; never store them in Git or Neon.
const assets=[
  ["pv","https://7fjd8g0k1zzzbv6u.private.blob.vercel-storage.com/loom-videos/pv-optimized-EqhqHzUF5hT5UjwqZokwaYhReHkNK0.mp4",10403079],
  ["pflege","https://7fjd8g0k1zzzbv6u.private.blob.vercel-storage.com/loom-videos/pflege-optimized-ysaSgG1qWe844o6mc1ySIjAaMGDEPh.mp4",9199813],
];
if(!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Missing Blob credentials; refusing broken Loom video deployment");
await mkdir("public/loom-videos",{recursive:true});
for(const [segment,url,size] of assets){
  const path=`public/loom-videos/${segment}.mp4`;
  const temp=path+".part";
  await rm(temp,{force:true});
  const response=await get(url,{access:"private"});
  if(response?.statusCode!==200||!response.stream)throw new Error(`Cannot read private ${segment} MP4 from Blob`);
  await pipeline(Readable.fromWeb(response.stream),createWriteStream(temp));
  const info=await stat(temp);
  if(info.size!==size)throw new Error(`Incomplete ${segment} MP4: got ${info.size}, expected ${size}`);
  await rename(temp,path);
  console.log(`[loom-assets] ${segment} bundled for CDN: ${info.size} bytes`);
}
