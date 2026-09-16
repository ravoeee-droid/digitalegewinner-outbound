import tls, { TLSSocket } from "node:tls";
import type { StoredMailboxCredential } from "@/lib/mailbox-credentials";

export type ImapMailboxCredential = StoredMailboxCredential & {
  imapHost?: string;
  imapPort?: number;
  imapUser?: string;
  imapPass?: string;
};

export type InboxMessage = {
  uid: number;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  date: string;
  messageId: string;
  replyTo: string;
  unread: boolean;
  bodyText: string;
};

function quote(value: string) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function decodeQuotedPrintable(value: string) {
  const normalized = value.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index];
    if (current === "=" && /^[0-9a-f]{2}$/i.test(normalized.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(normalized.slice(index + 1, index + 3), 16));
      index += 2;
      continue;
    }
    bytes.push(normalized.charCodeAt(index) & 0xff);
  }
  return Buffer.from(bytes);
}

function decodeBytes(buffer: Buffer, charset = "utf-8") {
  const normalized = charset.toLowerCase();
  if (normalized.includes("iso-8859-1") || normalized.includes("latin1") || normalized.includes("windows-1252")) {
    return buffer.toString("latin1");
  }
  return buffer.toString("utf8");
}

function decodeEncodedWords(value: string) {
  return value.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_match, charset: string, encoding: string, encoded: string) => {
    try {
      const bytes = encoding.toLowerCase() === "b"
        ? Buffer.from(encoded, "base64")
        : decodeQuotedPrintable(encoded.replace(/_/g, " "));
      return decodeBytes(bytes, charset);
    } catch {
      return encoded;
    }
  });
}

function parseHeaders(block: string) {
  const unfolded = block.replace(/\r?\n[\t ]+/g, " ");
  const headers = new Map<string, string>();
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    headers.set(name, headers.has(name) ? `${headers.get(name)}, ${value}` : value);
  }
  return headers;
}

function headerAndBody(raw: string) {
  const match = /\r?\n\r?\n/.exec(raw);
  if (!match || match.index === undefined) return { header: raw, body: "" };
  return { header: raw.slice(0, match.index), body: raw.slice(match.index + match[0].length) };
}

function contentType(headers: Map<string, string>) {
  const raw = headers.get("content-type") || "text/plain; charset=utf-8";
  const type = raw.split(";")[0].trim().toLowerCase();
  const charset = /charset\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(raw)?.slice(1).find(Boolean) || "utf-8";
  const boundary = /boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(raw)?.slice(1).find(Boolean) || "";
  return { type, charset, boundary };
}

function decodeTransfer(body: string, encoding: string, charset: string) {
  const normalized = encoding.trim().toLowerCase();
  if (normalized === "base64") {
    return decodeBytes(Buffer.from(body.replace(/\s+/g, ""), "base64"), charset);
  }
  if (normalized === "quoted-printable") {
    return decodeBytes(decodeQuotedPrintable(body), charset);
  }
  return decodeBytes(Buffer.from(body, "latin1"), charset);
}

function htmlToText(value: string) {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractText(rawPart: string): { plain: string; html: string } {
  const { header, body } = headerAndBody(rawPart);
  const headers = parseHeaders(header);
  const { type, charset, boundary } = contentType(headers);

  if (type.startsWith("multipart/") && boundary) {
    const delimiter = `--${boundary}`;
    const pieces = body.split(delimiter).slice(1).filter((part) => !part.startsWith("--"));
    let plain = "";
    let html = "";
    for (const piece of pieces) {
      const text = extractText(piece.replace(/^\r?\n/, "").replace(/\r?\n$/, ""));
      if (!plain && text.plain) plain = text.plain;
      if (!html && text.html) html = text.html;
    }
    return { plain, html };
  }

  const disposition = (headers.get("content-disposition") || "").toLowerCase();
  if (disposition.includes("attachment")) return { plain: "", html: "" };
  const decoded = decodeTransfer(body, headers.get("content-transfer-encoding") || "8bit", charset).trim();
  if (type === "text/plain") return { plain: decoded, html: "" };
  if (type === "text/html") return { plain: "", html: decoded };
  return { plain: "", html: "" };
}

function address(value: string) {
  const decoded = decodeEncodedWords(value || "");
  const angle = /<([^>]+)>/.exec(decoded)?.[1]?.trim();
  const bare = decoded.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  const email = angle || bare;
  const name = email ? decoded.replace(`<${email}>`, "").replace(email, "").replace(/^\s*"|"\s*$/g, "").trim() : decoded.trim();
  return { email, name };
}

export function parseRawEmail(raw: Buffer, uid: number, flags = "") : InboxMessage {
  const source = raw.toString("latin1");
  const { header } = headerAndBody(source);
  const headers = parseHeaders(header);
  const text = extractText(source);
  const from = address(headers.get("from") || "");
  const replyTo = address(headers.get("reply-to") || "").email || from.email;
  const to = address(headers.get("to") || "").email || decodeEncodedWords(headers.get("to") || "");
  const parsedDate = new Date(headers.get("date") || "");
  return {
    uid,
    from: from.email || decodeEncodedWords(headers.get("from") || ""),
    fromName: from.name,
    to,
    subject: decodeEncodedWords(headers.get("subject") || "(ohne Betreff)"),
    date: Number.isNaN(parsedDate.getTime()) ? "" : parsedDate.toISOString(),
    messageId: (headers.get("message-id") || "").trim(),
    replyTo,
    unread: !/\\Seen/i.test(flags),
    bodyText: (text.plain || htmlToText(text.html) || "(Kein darstellbarer Nachrichtentext)").slice(0, 250_000),
  };
}

class ImapConnection {
  private socket: TLSSocket | null = null;
  private sequence = 1;

  constructor(private readonly credential: ImapMailboxCredential) {}

  private host() {
    return String(this.credential.imapHost || "").trim();
  }

  private user() {
    return String(this.credential.imapUser || this.credential.smtpUser || this.credential.email || "").trim();
  }

  private password() {
    return String(this.credential.imapPass || this.credential.smtpPass || "");
  }

  async connect() {
    const host = this.host();
    if (!host || !this.user() || !this.password()) throw new Error("IMAP-Zugangsdaten fehlen.");
    const port = Number(this.credential.imapPort || 993);
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: true });
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("IMAP-Verbindung hat zu lange gedauert.")), 12_000);
      const cleanup = () => clearTimeout(timer);
      socket.once("secureConnect", () => { cleanup(); resolve(); });
      socket.once("error", (error) => { cleanup(); reject(error); });
    });
    const greeting = await this.readUntil((text) => /(?:^|\r\n)\*\s+(?:OK|PREAUTH)\b/i.test(text));
    if (!/\*\s+(?:OK|PREAUTH)\b/i.test(greeting.toString("latin1"))) throw new Error("IMAP-Server hat die Verbindung nicht akzeptiert.");
  }

  private readUntil(done: (text: string) => boolean) {
    const socket = this.socket;
    if (!socket) return Promise.reject(new Error("IMAP ist nicht verbunden."));
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => finish(new Error("IMAP-Antwort hat zu lange gedauert.")), 15_000);
      const onData = (chunk: Buffer) => {
        chunks.push(chunk);
        const combined = Buffer.concat(chunks);
        if (done(combined.toString("latin1"))) finish(null, combined);
      };
      const onError = (error: Error) => finish(error);
      const onClose = () => finish(new Error("IMAP-Verbindung wurde beendet."));
      const finish = (error: Error | null, value?: Buffer) => {
        clearTimeout(timer);
        socket.off("data", onData);
        socket.off("error", onError);
        socket.off("close", onClose);
        if (error) reject(error); else resolve(value || Buffer.concat(chunks));
      };
      socket.on("data", onData);
      socket.once("error", onError);
      socket.once("close", onClose);
    });
  }

  async command(command: string) {
    const socket = this.socket;
    if (!socket) throw new Error("IMAP ist nicht verbunden.");
    const tag = `A${String(this.sequence++).padStart(4, "0")}`;
    const resultPromise = this.readUntil((text) => new RegExp(`(?:^|\\r\\n)${tag}\\s+(?:OK|NO|BAD)\\b`, "i").test(text));
    socket.write(`${tag} ${command}\r\n`);
    const result = await resultPromise;
    const text = result.toString("latin1");
    const status = new RegExp(`(?:^|\\r\\n)${tag}\\s+(OK|NO|BAD)\\b`, "i").exec(text)?.[1]?.toUpperCase();
    if (status !== "OK") {
      const detail = text.split(/\r?\n/).find((line) => line.startsWith(tag)) || "IMAP-Befehl fehlgeschlagen.";
      throw new Error(detail.replace(/^A\d+\s+(?:NO|BAD)\s*/i, ""));
    }
    return result;
  }

  async login(writable = false) {
    await this.command(`LOGIN ${quote(this.user())} ${quote(this.password())}`);
    await this.command(writable ? 'SELECT "INBOX"' : 'EXAMINE "INBOX"');
  }

  async findUidBySubjectToken(token: string) {
    const search = await this.command(`UID SEARCH HEADER SUBJECT ${quote(token)}`);
    const uids = searchUids(search);
    return uids.length ? Math.max(...uids) : null;
  }

  async markSeen(uid: number) {
    await this.command(`UID STORE ${uid} +FLAGS (\\Seen)`);
  }

  async logout() {
    try { await this.command("LOGOUT"); } catch {}
    this.socket?.destroy();
    this.socket = null;
  }
}

function searchUids(buffer: Buffer) {
  const match = /(?:^|\r\n)\* SEARCH\s*([^\r\n]*)/i.exec(buffer.toString("latin1"));
  if (!match) return [] as number[];
  return match[1].trim().split(/\s+/).map(Number).filter((value) => Number.isInteger(value) && value > 0);
}

function literalFromFetch(buffer: Buffer) {
  const source = buffer.toString("latin1");
  const match = /\{(\d+)\}\r\n/.exec(source);
  if (!match || match.index === undefined) throw new Error("IMAP-Nachricht konnte nicht gelesen werden.");
  const start = match.index + match[0].length;
  const length = Number(match[1]);
  const flags = /FLAGS\s*\(([^)]*)\)/i.exec(source.slice(0, match.index))?.[1] || "";
  return { raw: buffer.subarray(start, start + length), flags };
}

export async function testImapConnection(credential: ImapMailboxCredential) {
  const connection = new ImapConnection(credential);
  try {
    await connection.connect();
    await connection.login();
    await connection.command("NOOP");
    return true;
  } finally {
    await connection.logout();
  }
}

export async function markSeenBySubjectToken(credential: ImapMailboxCredential, token: string) {
  const connection = new ImapConnection(credential);
  try {
    await connection.connect();
    await connection.login(true);
    const uid = await connection.findUidBySubjectToken(token);
    if (uid) await connection.markSeen(uid);
    return Boolean(uid);
  } finally {
    await connection.logout();
  }
}

export async function listImapMessages(credential: ImapMailboxCredential, requestedLimit = 30) {
  const limit = Math.max(1, Math.min(50, Number(requestedLimit) || 30));
  const connection = new ImapConnection(credential);
  try {
    await connection.connect();
    await connection.login();
    const search = await connection.command("UID SEARCH ALL");
    const uids = searchUids(search).sort((a, b) => b - a).slice(0, limit);
    const messages: InboxMessage[] = [];
    for (const uid of uids) {
      try {
        const response = await connection.command(`UID FETCH ${uid} (UID FLAGS BODY.PEEK[])`);
        const { raw, flags } = literalFromFetch(response);
        messages.push(parseRawEmail(raw, uid, flags));
      } catch {
        // Eine beschädigte Mail darf nicht das gesamte Postfach blockieren.
      }
    }
    return messages;
  } finally {
    await connection.logout();
  }
}
