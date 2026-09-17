import { put } from "@vercel/blob";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 200 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Keine Datei erhalten." }, { status: 400 });
    if (!file.type.startsWith("video/")) return Response.json({ error: "Nur Video-Dateien erlaubt." }, { status: 400 });
    if (file.size > MAX_BYTES) return Response.json({ error: "Video zu groß (max. 200 MB)." }, { status: 400 });
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "pitch-video.mp4";
    const blob = await put(`pitch-videos/${Date.now()}-${safeName}`, file, { access: "public", contentType: file.type });
    return Response.json({ ok: true, url: blob.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload fehlgeschlagen.";
    const normalized = /BLOB_READ_WRITE_TOKEN|No token found/i.test(message)
      ? "Vercel Blob Storage ist noch nicht verbunden. Im Vercel-Dashboard unter Storage → Blob einmalig aktivieren."
      : message;
    return Response.json({ error: normalized }, { status: 503 });
  }
}
