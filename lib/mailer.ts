import nodemailer from "nodemailer";

type MailboxConfig = {
  provider: "gmail" | "microsoft" | "smtp";
  email: string;
  name?: string;
  accessToken?: string;
  refreshToken?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
};

type SendInput = MailboxConfig & { to: string; subject: string; text: string; html?: string; replyTo?: string };

function mimeHeader(value: string) { return value.replace(/[\r\n]+/g, " ").trim(); }

async function googleToken(input: MailboxConfig) {
  if (input.accessToken) return input.accessToken;
  if (!input.refreshToken || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) throw new Error("Google OAuth Credentials fehlen.");
  const body = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: input.refreshToken, grant_type: "refresh_token" });
  const r = await fetch("https://oauth2.googleapis.com/token", { method:"POST", headers:{"content-type":"application/x-www-form-urlencoded"}, body });
  if (!r.ok) throw new Error(`Google Token Refresh fehlgeschlagen (${r.status}).`);
  const j = await r.json() as { access_token?: string };
  if (!j.access_token) throw new Error("Google Access Token fehlt.");
  return j.access_token;
}

async function microsoftToken(input: MailboxConfig) {
  if (input.accessToken) return input.accessToken;
  if (!input.refreshToken || !process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_CLIENT_SECRET) throw new Error("Microsoft OAuth Credentials fehlen.");
  const body = new URLSearchParams({ client_id:process.env.MICROSOFT_CLIENT_ID, client_secret:process.env.MICROSOFT_CLIENT_SECRET, refresh_token:input.refreshToken, grant_type:"refresh_token", scope:"offline_access Mail.Send Mail.Read" });
  const r = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", { method:"POST", headers:{"content-type":"application/x-www-form-urlencoded"}, body });
  if (!r.ok) throw new Error(`Microsoft Token Refresh fehlgeschlagen (${r.status}).`);
  const j = await r.json() as { access_token?: string };
  if (!j.access_token) throw new Error("Microsoft Access Token fehlt.");
  return j.access_token;
}

async function sendGmail(input: SendInput) {
  const accessToken = await googleToken(input);
  const raw = [
    `From: ${mimeHeader(input.name || input.email)} <${input.email}>`,
    `To: ${mimeHeader(input.to)}`,
    `Subject: ${mimeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    input.text,
  ].join("\r\n");
  const encoded = Buffer.from(raw).toString("base64url");
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: encoded }),
  });
  if (!response.ok) throw new Error(`Gmail Versand fehlgeschlagen (${response.status}).`);
  const payload = await response.json() as { id?: string; threadId?: string };
  return { id: payload.id || crypto.randomUUID(), threadId: payload.threadId };
}

async function sendMicrosoft(input: SendInput) {
  const accessToken = await microsoftToken(input);
  const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: input.subject,
        body: { contentType: input.html ? "HTML" : "Text", content: input.html || input.text },
        toRecipients: [{ emailAddress: { address: input.to } }],
        ...(input.replyTo ? { replyTo: [{ emailAddress: { address: input.replyTo } }] } : {}),
      },
      saveToSentItems: true,
    }),
  });
  if (!response.ok) throw new Error(`Microsoft Versand fehlgeschlagen (${response.status}).`);
  return { id: crypto.randomUUID() };
}

async function sendSmtp(input: SendInput) {
  if (!input.smtpHost || !input.smtpUser || !input.smtpPass) throw new Error("SMTP Zugangsdaten fehlen.");
  const transport = nodemailer.createTransport({
    host: input.smtpHost,
    port: input.smtpPort || 587,
    secure: (input.smtpPort || 587) === 465,
    auth: { user: input.smtpUser, pass: input.smtpPass },
  });
  const info = await transport.sendMail({ from: { name: input.name || input.email, address: input.email }, to: input.to, subject: input.subject, text: input.text, html: input.html, replyTo: input.replyTo });
  return { id: info.messageId };
}

export async function sendMail(input: SendInput) {
  if (input.provider === "gmail") return sendGmail(input);
  if (input.provider === "microsoft") return sendMicrosoft(input);
  return sendSmtp(input);
}
