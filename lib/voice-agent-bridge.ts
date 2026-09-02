type VoiceProvider = "cloudtalk" | "pipecat";

type VoiceCallInput = {
  phone: string;
  name?: string;
  company?: string;
  purpose: "demo" | "callback";
  consentConfirmed: true;
  context?: Record<string, string | number | boolean>;
};

function provider(): VoiceProvider {
  return process.env.VOICE_AGENT_PROVIDER === "pipecat" ? "pipecat" : "cloudtalk";
}

export function getVoiceAgentStatus() {
  const current = provider();
  if (current === "pipecat") {
    return {
      provider: current,
      configured: Boolean(process.env.PIPECAT_WORKER_URL),
      autoDial: false,
      modes: ["inbound", "demo", "callback"],
    };
  }
  return {
    provider: current,
    configured: Boolean(process.env.CLOUDTALK_API_KEY_ID && process.env.CLOUDTALK_API_KEY && process.env.CLOUDTALK_VOICE_AGENT_ID),
    autoDial: false,
    modes: ["inbound", "demo", "callback"],
  };
}

function assertPhone(phone: string) {
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error("Telefonnummer muss im E.164-Format vorliegen.");
}

export async function startVoiceAgentCall(input: VoiceCallInput) {
  if (input.consentConfirmed !== true) throw new Error("Voice-AI-Anrufe werden nur für Demo/angeforderte Rückrufe gestartet.");
  if (!new Set(["demo", "callback"]).has(input.purpose)) throw new Error("Nicht unterstützter Voice-Call-Modus.");
  assertPhone(input.phone);

  const current = provider();
  if (current === "pipecat") return startPipecatCall(input);
  return startCloudTalkCall(input);
}

async function startCloudTalkCall(input: VoiceCallInput) {
  const keyId = process.env.CLOUDTALK_API_KEY_ID || "";
  const key = process.env.CLOUDTALK_API_KEY || "";
  const voiceAgentId = process.env.CLOUDTALK_VOICE_AGENT_ID || "";
  if (!keyId || !key || !voiceAgentId) throw new Error("CloudTalk VoiceAgent ist nicht vollständig konfiguriert.");

  const variables = {
    name: input.name || "",
    company: input.company || "",
    purpose: input.purpose,
    ...input.context,
  };

  const response = await fetch("https://api.cloudtalk.io/v1/voice-agent/calls", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from(`${keyId}:${key}`).toString("base64")}`,
    },
    body: JSON.stringify({
      call_number: input.phone,
      voice_agent_id: voiceAgentId,
      call_properties: {
        system_prompt: { variables },
        output: { variables: { purpose: input.purpose, company: input.company || "" } },
      },
    }),
  });

  const body = await response.text();
  if (!response.ok) throw new Error(`CloudTalk VoiceAgent ${response.status}: ${body.slice(0, 500)}`);
  let data: unknown = body;
  try { data = JSON.parse(body); } catch {}
  return { ok: true, provider: "cloudtalk" as const, result: data };
}

async function startPipecatCall(input: VoiceCallInput) {
  const url = (process.env.PIPECAT_WORKER_URL || "").replace(/\/$/, "");
  const secret = process.env.PIPECAT_WORKER_SECRET || "";
  if (!url) throw new Error("PIPECAT_WORKER_URL fehlt.");

  const response = await fetch(`${url}/v1/calls`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(input),
  });

  const body = await response.text();
  if (!response.ok) throw new Error(`Pipecat Worker ${response.status}: ${body.slice(0, 500)}`);
  let data: unknown = body;
  try { data = JSON.parse(body); } catch {}
  return { ok: true, provider: "pipecat" as const, result: data };
}
