import { promises as dns } from "node:dns";
import { z } from "zod";

export const runtime = "nodejs";
const schema = z.object({ domain: z.string().min(3).max(255).regex(/^[a-z0-9.-]+$/i) });

export async function POST(request: Request) {
  try {
    const { domain } = schema.parse(await request.json());
    const [mx, txt, dmarcTxt] = await Promise.all([
      dns.resolveMx(domain).catch(() => []),
      dns.resolveTxt(domain).catch(() => []),
      dns.resolveTxt(`_dmarc.${domain}`).catch(() => []),
    ]);
    const flatTxt = txt.map((x) => x.join(""));
    const dmarc = dmarcTxt.map((x) => x.join("")).find((x) => /^v=DMARC1/i.test(x)) || "";
    const spf = flatTxt.find((x) => /^v=spf1/i.test(x)) || "";
    const score = (mx.length ? 30 : 0) + (spf ? 35 : 0) + (dmarc ? 35 : 0);
    return Response.json({ domain, mx: mx.length > 0, spf: Boolean(spf), spfRecord: spf, dmarc: Boolean(dmarc), dmarcRecord: dmarc, dkim: "selector-dependent", score, note: "DKIM wird pro Mailbox/Selector beim Provider-OAuth bzw. SMTP-Test verifiziert." });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Domain-Check fehlgeschlagen." }, { status: 400 });
  }
}
