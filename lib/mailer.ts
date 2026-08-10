import nodemailer from "nodemailer";

type MailboxConfig = {
  provider: "gmail" | "microsoft" | "smtp";
  email: string;
  name?: string;
  accessToken?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
};

type SendInput = MailboxConfig & { to: string; subject: string; text: string; html?: string; replyTo?: string };

function mimeHeader(value: string) { return value.replace(/[\r\n]+/g, " ").trim(); }

async function sendGmail(input: SendInput) {
  if (!input.accessToken) throw new Error("Gmail access token fehlt.");
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
    headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: encoded }),
  });
  if (!response.ok) throw new Error(`Gmail Versand fehlgeschlagen (${response.status}).`);
  const payload = await response.json() as { id?: string; threadId?: string };
  return { id: payload.id || crypto.randomUUID(), threadId: payload.threadId };
}

async function sendMicrosoft(input: SendInput) {
  if (!input.accessToken) throw new Error("Microsoft access token fehlt.");
  const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" },
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
