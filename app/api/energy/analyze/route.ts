import { z } from "zod";

const schema = z.object({
  industry:z.string().default(""), employees:z.number().min(0).default(0), roofArea:z.number().min(0).default(0), pvExisting:z.boolean().default(false),
  hasFleet:z.boolean().optional().default(false), hasParking:z.boolean().optional().default(false), annualConsumptionKwh:z.number().positive().optional(),
});

export async function POST(request:Request){
  try{
    const x=schema.parse(await request.json());
    const text=x.industry.toLowerCase();
    let score=28; const reasons:string[]=[]; const offers:string[]=[];
    if(/metall|produktion|logistik|kunststoff|maschinen|lebensmittel|bäck|hotel/.test(text)){score+=20;reasons.push("energieintensive bzw. verbrauchsstarke Branche");}
    if(x.employees>=20){score+=8;reasons.push("relevante Betriebsgröße");}
    if(x.employees>=80) score+=7;
    if(x.roofArea>=1000){score+=14;reasons.push("größere potenziell nutzbare Dachfläche"); offers.push("Gewerbe-PV");}
    if(x.roofArea>=3000) score+=10;
    if(!x.pvExisting){score+=10;offers.push("PV-Potenzialprüfung");} else {offers.push("Speicher / Eigenverbrauchsoptimierung");}
    if(x.hasFleet){score+=5;offers.push("Ladeinfrastruktur");}
    if(x.hasParking) offers.push("PV-Carport");
    if(x.annualConsumptionKwh && x.annualConsumptionKwh>100000){score+=8;reasons.push("hoher angegebener Jahresstromverbrauch");}
    score=Math.max(0,Math.min(100,score));
    const estimatedKwp=x.roofArea?Math.round(x.roofArea*0.18):null;
    return Response.json({score,reasons,offers:[...new Set(offers)],estimatedKwp,confidence:x.annualConsumptionKwh?"medium":"low",disclaimer:"Automatische Vorabschätzung. Keine technische Planung, Wirtschaftlichkeits- oder Förderzusage."});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Analyse fehlgeschlagen."},{status:400});}
}
