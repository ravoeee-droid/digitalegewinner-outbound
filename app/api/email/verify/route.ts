import { promises as dns } from "node:dns";
import { z } from "zod";

export const runtime = "nodejs";
const schema = z.object({ email: z.string().email() });

export async function POST(request: Request) {
  try {
    const { email } = schema.parse(await request.json());
    const domain = email.split("@")[1].toLowerCase();
    const mx = await dns.resolveMx(domain).catch(() => []);
    const disposable = /mailinator|guerrillamail|10minutemail|tempmail/i.test(domain);
    const role = /^(info|office|kontakt|contact|hello|support|sales|admin)@/i.test(email);
    const status = !mx.length || disposable ? "invalid" : role ? "risky" : "valid";
    return Response.json({ email, domain, status, mx: mx.sort((a,b)=>a.priority-b.priority).slice(0,5), checks: { syntax: true, mx: mx.length > 0, disposable: !disposable, roleAccount: role } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "E-Mail-Prüfung fehlgeschlagen." }, { status: 400 });
  }
}
