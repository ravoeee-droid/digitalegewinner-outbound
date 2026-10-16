import { promises as dns } from "node:dns";
import { z } from "zod";
import { loadMailboxCredentials, saveVerifiedMailboxes } from "@/lib/mailbox-credentials";
import { verifyMailbox, publicMailbox, type NetcupCredential } from "@/lib/mailbox-verification";

export const runtime = "nodejs";
export const maxDuration = 30;

const setupSchema = z.object({
  id: z.string().trim().min(1).max(80).regex(/^[a-z0-9_-]+$/i).optional(),
  name: z.string().trim().max(120).optional().default("Raphael Hermann"),
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(500),
  username: z.string().trim().max(254).optional(),
  imapHost: z.string().trim().max(255).optional(),
  imapPort: z.number().int().min(1).max(65535).optional(),
  smtpHost: z.string().trim().max(255).optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
});

async function detectMailHost(email: string) {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) throw new Error("E-Mail-Domain fehlt.");
  const records = await dns.resolveMx(domain).catch(() => []);
  const best = [...records].sort((a, b) => a.priority - b.priority)[0]?.exchange?.replace(/\.$/, "");
  if (!best) throw new Error("Mailserver konnte nicht automatisch erkannt werden. Öffne 'Erweiterte Serverdaten' und trage den Netcup-Mailserver ein.");
  return best;
}

export async function GET() {
  try {
    const credentials = await loadMailboxCredentials();
    const items = credentials
      .filter((item) => item.provider === "smtp")
      .map((item) => publicMailbox(item as NetcupCredential));
    return Response.json({ items });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Mailbox-Konfiguration konnte nicht geladen werden." }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  try {
    const input = setupSchema.parse(await request.json());
    const detectedHost = (!input.imapHost || !input.smtpHost) ? await detectMailHost(input.email) : "";
    const username = input.username || input.email;
    const credential: NetcupCredential = {
      id: input.id || `mb-${input.email.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      provider: "smtp",
      email: input.email.toLowerCase(),
      name: input.name || "Raphael Hermann",
      smtpHost: input.smtpHost || detectedHost,
      smtpPort: Number(input.smtpPort || 465),
      smtpUser: username,
      smtpPass: input.password,
      imapHost: input.imapHost || detectedHost,
      imapPort: Number(input.imapPort || 993),
      imapUser: username,
      imapPass: input.password,
    };

    await verifyMailbox(credential);
    await saveVerifiedMailboxes([credential]);
    const nextMailbox = { id: credential.id, email: credential.email, enabled: true, dailyLimit: 5 };

    return Response.json({ ok: true, mailbox: publicMailbox(credential), campaignMailbox: nextMailbox });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Mailbox konnte nicht verbunden werden.";
    const normalized = /authentication|auth|login|credentials|password/i.test(message)
      ? "Anmeldung am Mailserver fehlgeschlagen. Prüfe E-Mail-Adresse, Passwort und ggf. die Netcup-Serverdaten."
      : message;
    return Response.json({ error: normalized }, { status: 400 });
  }
}
