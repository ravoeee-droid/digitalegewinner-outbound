import { createHash } from "node:crypto";
import { z } from "zod";
import { verifyMailbox, publicMailbox, type NetcupCredential } from "@/lib/mailbox-verification";
import { loadMailboxCredentials, saveVerifiedMailboxes } from "@/lib/mailbox-credentials";
import { DG_MAILBOX_EMAILS } from "@/lib/dg-mailboxes";

export const runtime = "nodejs";
export const maxDuration = 300;
const inputSchema = z.object({ password: z.string().max(500).default(""), reuseSaved: z.boolean().default(false), name: z.string().trim().max(120).default("Raphael Hermann") });

export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await request.json());
    const existing = await loadMailboxCredentials();
    const connected = existing.filter(item => item.provider === "smtp" && DG_MAILBOX_EMAILS.some(email => email === item.email.toLowerCase()) && item.smtpPass && (item as NetcupCredential).imapHost && item.smtpHost);
    let password = input.password;
    if (!password && input.reuseSaved) {
      // Reuse only the one common password held by this instance's fixed DG
      // Netcup accounts. Never return credentials to the browser.
      const eligible = connected.filter(item => item.smtpHost === "mxe9bf.netcup.net" && (item as NetcupCredential).imapHost === "mxe9bf.netcup.net");
      const passwords = [...new Set(eligible.map(item => item.smtpPass).filter(Boolean))];
      if (passwords.length === 1) password = passwords[0]!;
    }
    if (!password) return Response.json({ error: "Kein eindeutiges gemeinsames Passwort gespeichert. Bitte das Netcup-Mailpasswort eingeben." }, { status: 400 });
    const verified: NetcupCredential[] = [];
    const failures: Array<{ email: string; error: string }> = [];
    // Preserve existing accounts and IDs. Verify missing addresses sequentially
    // rather than bursting simultaneous Netcup logins.
    const missing = DG_MAILBOX_EMAILS.filter(email => !connected.some(item => item.email.toLowerCase() === email));
    for (const email of missing) {
      const sameEmail = existing.find(item => item.email.toLowerCase() === email);
      const credential: NetcupCredential = {
        id: sameEmail?.id || `mb-${createHash("sha256").update(email).digest("hex").slice(0, 32)}`,
        provider: "smtp", email, name: input.name,
        smtpHost: "mxe9bf.netcup.net", smtpPort: 465, smtpUser: email, smtpPass: password,
        imapHost: "mxe9bf.netcup.net", imapPort: 993, imapUser: email, imapPass: password,
      };
      try { await verifyMailbox(credential); verified.push(credential); }
      catch (error) { failures.push({ email, error: error instanceof Error ? error.message : "IMAP- oder SMTP-Prüfung fehlgeschlagen." }); }
    }
    await saveVerifiedMailboxes(verified);
    return Response.json({ ok: failures.length === 0, connected: connected.length + verified.length, added: verified.length, total: 10, items: [...connected, ...verified].map(item => publicMailbox(item as NetcupCredential)), failures });
  } catch (error) {
    return Response.json({ error: error instanceof z.ZodError ? "Bitte die Postfachangaben prüfen." : "Die Postfächer konnten nicht gespeichert werden. Bitte erneut versuchen." }, { status: error instanceof z.ZodError ? 400 : 503 });
  }
}
