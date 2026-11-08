// CloudTalk Core API (my.cloudtalk.io): Basic Auth mit Access Key ID und Secret aus den Umgebungsvariablen. Legt an per PUT.
export function toE164(raw: string) {
  const d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (d.startsWith("00")) return `+${d.slice(2)}`;
  if (d.startsWith("0")) return `+49${d.slice(1)}`;
  return d;
}

export type CloudTalkContact = { name: string; company: string; phone: string; email: string; city: string; website: string; tag: string };

export function cloudtalkConfigured() {
  return Boolean(process.env.CLOUDTALK_API_ID && process.env.CLOUDTALK_API_SECRET);
}

export async function addCloudTalkContact(c: CloudTalkContact) {
  const auth = Buffer.from(`${process.env.CLOUDTALK_API_ID}:${process.env.CLOUDTALK_API_SECRET}`).toString("base64");
  const res = await fetch("https://my.cloudtalk.io/api/contacts/add.json", {
    method: "PUT",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
    body: JSON.stringify({
      name: c.name || c.company, company: c.company, city: c.city, website: c.website,
      ContactNumber: [{ public_number: c.phone }],
      ...(c.email ? { ContactEmail: [{ email: c.email }] } : {}),
      ContactsTag: [{ name: c.tag }],
    }),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`CloudTalk HTTP ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  return String(json?.responseData?.data?.id || "");
}
