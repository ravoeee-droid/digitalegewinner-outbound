import { z } from "zod";
import { getSecret } from "@/lib/secrets";

export const runtime="nodejs";
const schema=z.object({lat:z.number().min(-90).max(90),lng:z.number().min(-180).max(180)});
type SolarResponse={imageryQuality?:string;imageryDate?:{year?:number;month?:number;day?:number};solarPotential?:{maxArrayPanelsCount?:number;maxArrayAreaMeters2?:number;maxSunshineHoursPerYear?:number;panelCapacityWatts?:number;wholeRoofStats?:{areaMeters2?:number;sunshineQuantiles?:number[]};solarPanelConfigs?:Array<{panelsCount?:number;yearlyEnergyDcKwh?:number}>};detectedArrays?:{detectionStatus?:string;latestCaptureDate?:{year?:number;month?:number;day?:number}}};

export async function POST(request:Request){
 try{
  const {lat,lng}=schema.parse(await request.json());
  const key=process.env.GOOGLE_MAPS_API_KEY||await getSecret("google_maps_api_key");
  if(!key)return Response.json({error:"Google Solar API ist noch nicht verbunden."},{status:503});
  const params=new URLSearchParams({"location.latitude":String(lat),"location.longitude":String(lng),requiredQuality:"BASE",additionalInsights:"DETECTED_ARRAYS",key});
  const r=await fetch(`https://solar.googleapis.com/v1/buildingInsights:findClosest?${params.toString()}`,{cache:"no-store"});
  if(r.status===404)return Response.json({found:false,error:"Für diesen Standort liegen keine Solar-Gebäudedaten vor."},{status:404});
  if(!r.ok)return Response.json({error:`Google Solar API Fehler (${r.status}).`},{status:502});
  const data=await r.json() as SolarResponse;const p=data.solarPotential;const best=p?.solarPanelConfigs?.reduce((a,b)=>(Number(b.yearlyEnergyDcKwh||0)>Number(a?.yearlyEnergyDcKwh||0)?b:a),p.solarPanelConfigs?.[0]);
  const existing=data.detectedArrays?.detectionStatus==="DETECTION_STATUS_ARRAYS_DETECTED";
  const area=Math.round(p?.wholeRoofStats?.areaMeters2||p?.maxArrayAreaMeters2||0);
  const estimatedKwp=p?.maxArrayPanelsCount&&p?.panelCapacityWatts?Math.round((p.maxArrayPanelsCount*p.panelCapacityWatts)/1000):null;
  return Response.json({found:true,imageryQuality:data.imageryQuality||null,imageryDate:data.imageryDate||null,roofAreaMeters2:area||null,maxPanels:p?.maxArrayPanelsCount||null,estimatedKwp,maxSunshineHours:p?.maxSunshineHoursPerYear?Math.round(p.maxSunshineHoursPerYear):null,maxYearlyEnergyKwh:best?.yearlyEnergyDcKwh?Math.round(best.yearlyEnergyDcKwh):null,pvDetected:existing,detectionStatus:data.detectedArrays?.detectionStatus||"unknown",captureDate:data.detectedArrays?.latestCaptureDate||null,disclaimer:"Google Solar API Vorabschätzung auf Basis verfügbarer Geodaten; Vor-Ort-Prüfung, Statik, Netzanschluss und Verbrauchsdaten bleiben erforderlich."});
 }catch(error){return Response.json({error:error instanceof Error?error.message:"Solar-Analyse fehlgeschlagen."},{status:400})}
}
