import { z } from "zod";
import { getSecret } from "@/lib/secrets";

export const runtime="nodejs";
const schema=z.object({query:z.string().min(3).max(300),pageSize:z.number().int().min(1).max(20).default(20)});

type Place={id?:string;displayName?:{text?:string};formattedAddress?:string;websiteUri?:string;nationalPhoneNumber?:string;primaryTypeDisplayName?:{text?:string};location?:{latitude?:number;longitude?:number}};
export async function POST(request:Request){
 try{
  const input=schema.parse(await request.json());
  const key=process.env.GOOGLE_MAPS_API_KEY||await getSecret("google_maps_api_key");
  if(!key)return Response.json({error:"Google Maps / Places API ist noch nicht verbunden."},{status:503});
  const r=await fetch("https://places.googleapis.com/v1/places:searchText",{method:"POST",headers:{"content-type":"application/json","X-Goog-Api-Key":key,"X-Goog-FieldMask":"places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.primaryTypeDisplayName,places.location"},body:JSON.stringify({textQuery:input.query,pageSize:input.pageSize,languageCode:"de"})});
  if(!r.ok)return Response.json({error:`Google Places Fehler (${r.status}).`},{status:502});
  const data=await r.json() as {places?:Place[]};
  const leads=(data.places||[]).map((p)=>({id:p.id||crypto.randomUUID(),company:p.displayName?.text||"Unbekannt",contact:"",email:"",phone:p.nationalPhoneNumber||"",website:p.websiteUri||"",city:p.formattedAddress||"",industry:p.primaryTypeDisplayName?.text||"",employees:0,roofArea:0,pvExisting:false,energyScore:0,intentScore:0,stage:"Neu",dealValue:0,notes:"Quelle: Google Places",lat:p.location?.latitude,lng:p.location?.longitude}));
  return Response.json({leads,count:leads.length});
 }catch(error){return Response.json({error:error instanceof Error?error.message:"Lead-Suche fehlgeschlagen."},{status:400})}
}
