import { query } from "@/lib/db";
import { getSecret, setSecret } from "@/lib/secrets";

export type LinkedinPost = {
  id: string;
  text: string;
  scheduled_at: string | Date | null;
  status: "draft" | "scheduled" | "publishing" | "published" | "failed" | "uncertain" | "cancelled";
  attempts: number;
  post_urn: string | null;
  published_at: string | Date | null;
  error: string | null;
  created_at: string | Date;
};

export async function ensureLinkedinSchema() {
  await query(
    "create table if not exists dg_linkedin_posts (" +
    "id uuid primary key, text text not null, scheduled_at timestamptz, " +
    "status text not null default 'draft' check (status in ('draft','scheduled','publishing','published','failed','uncertain','cancelled')), " +
    "attempts integer not null default 0, post_urn text, published_at timestamptz, error text, " +
    "created_at timestamptz not null default now(), updated_at timestamptz not null default now());"
  );
  await query("create index if not exists dg_linkedin_due_idx on dg_linkedin_posts(status, scheduled_at)");
}

export function linkedinOAuthSettings() {
  const clientId = process.env.LINKEDIN_CLIENT_ID || "";
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET || "";
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  return {
    clientId,
    clientSecret,
    appUrl,
    configured: Boolean(clientId && clientSecret && appUrl)
  };
}

export async function linkedinConnection() {
  const [token, authorUrn, expiry] = await Promise.all([
    getSecret("dg_linkedin_access_token").catch(() => ""),
    getSecret("dg_linkedin_author_urn").catch(() => ""),
    getSecret("dg_linkedin_token_expires").catch(() => "")
  ]);
  const expiresAt = expiry ? Number(expiry) : 0;
  return {
    connected: Boolean(token && authorUrn && expiresAt > Date.now() + 120000),
    authorUrn: authorUrn || null,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    accessToken: token
  };
}

export async function storeLinkedinConnection(accessToken: string, memberId: string, expiresIn: number) {
  if (!accessToken || !/^[A-Za-z0-9_-]{2,160}$/.test(memberId)) throw new Error("LinkedIn-Profil-ID fehlt.");
  await setSecret("dg_linkedin_access_token", accessToken);
  await setSecret("dg_linkedin_author_urn", "urn:li:person:" + memberId);
  await setSecret("dg_linkedin_token_expires", String(Date.now() + Math.max(0, expiresIn - 120) * 1000));
}

export class LinkedinPublishError extends Error {
  constructor(message: string, public uncertain = false) { super(message); }
}

export async function publishLinkedinText(text: string, accessToken: string, authorUrn: string) {
  const response = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json",
      "Linkedin-Version": process.env.LINKEDIN_API_VERSION || "202609",
      "X-Restli-Protocol-Version": "2.0.0"
    },
    body: JSON.stringify({
      author: authorUrn,
      commentary: text,
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false
    }),
    signal: AbortSignal.timeout(20000)
  });
  if (response.status !== 201) {
    const details = (await response.text()).slice(0, 500);
    throw new LinkedinPublishError(
      "LinkedIn HTTP " + response.status + ": " + details,
      response.status >= 500 || response.status === 429
    );
  }
  const urn = response.headers.get("x-restli-id");
  if (!urn) throw new LinkedinPublishError("LinkedIn 201 ohne Post-ID: Veröffentlichung prüfen.", true);
  return urn;
}
