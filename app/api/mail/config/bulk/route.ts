import { z } from "zod";
import { verifyDgMailboxes, publicMailbox } from "@/lib/mailbox-verification";
import { loadMailboxCredentials, saveVerifiedMailboxes } from "@/lib/mailbox-credentials";

export const runtime="nodejs";
export const maxDuration=300;
const inputSchema=z.object({password:z.string().min(1).max(500),name:z.string().trim().max(120).default("Raphael Hermann")});

export async function POST(request:Request) {
 try {
  const input=inputSchema.parse(await request.json());
  // Confirm vault access before attempting any mail-server logins.
  await loadMailboxCredentials();
  const {verified,failures}=await verifyDgMailboxes(input.password,input.name);
  await saveVerifiedMailboxes(verified);
  return Response.json({ok:failures.length===0,connected:verified.length,total:10,items:verified.map(publicMailbox),failures});
 } catch(error) {
  return Response.json({error:error instanceof z.ZodError?"Bitte das gemeinsame Mailpasswort eingeben.":"Die Postfächer konnten nicht gespeichert werden. Bitte erneut versuchen."},{status:error instanceof z.ZodError?400:503});
 }
}
