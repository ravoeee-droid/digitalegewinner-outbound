import { z } from "zod";
import { deleteSecret, secretStatus, setSecret } from "@/lib/secrets";

const allowed = [
  "experiential_api_key",
  "groq_api_key",
  "openai_api_key",
  "google_maps_api_key",
  "email_verifier_api_key",
  "google_client_id",
  "google_client_secret",
  "microsoft_client_id",
  "microsoft_client_secret",
  "mailbox_credentials_json",
  "video_renderer_url",
  "video_renderer_secret",
] as const;
const keySchema = z.enum(allowed);
const input = z.object({ key: keySchema, value: z.string().max(50000) });

export async function GET() {
  try {
    return Response.json({ items: await secretStatus() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Secrets nicht erreichbar." }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  try {
    const x = input.parse(await request.json());
    if (!x.value.trim()) await deleteSecret(x.key);
    else await setSecret(x.key, x.value.trim());
    return Response.json({ ok: true, key: x.key, configured: Boolean(x.value.trim()) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Integration konnte nicht gespeichert werden." }, { status: 400 });
  }
}
