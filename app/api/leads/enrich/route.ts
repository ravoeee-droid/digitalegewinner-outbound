import { z } from "zod";
import { enrichPublicContact } from "@/lib/contact-enrichment";

export const runtime="nodejs";
export const maxDuration=30;
const schema=z.object({website:z.string().min(3).max(500)});

export async function POST(request:Request){
 try{const input=schema.parse(await request.json());const contact=await enrichPublicContact(input.website);return Response.json({contact})}
 catch(error){return Response.json({error:error instanceof Error?error.message:"Kontakt-Enrichment fehlgeschlagen."},{status:400})}
}
