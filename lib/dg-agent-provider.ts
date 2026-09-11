import OpenAI from "openai";
import { getSecret } from "@/lib/secrets";

export type DgAgentMode = "auto" | "fast" | "smart" | "vision";
export type DgAgentProvider = "experiential" | "groq";

export type DgAgentToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type DgAgentMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: DgAgentToolCall[];
};

export type DgAgentToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type DgAgentCompletion = {
  content: string;
  toolCalls: DgAgentToolCall[];
  provider: DgAgentProvider;
  model: string;
  fallbackUsed: boolean;
  attempts: Array<{ provider: DgAgentProvider; model: string; ok: boolean; error?: string }>;
};

const EXPERIENTIAL_BASE_URL = "https://api.experientiallabs.ai/v1";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const MODELS = {
  fast: process.env.EXPERIENTIAL_MODEL_FAST || "deepseek-v4-flash",
  smart: process.env.EXPERIENTIAL_MODEL_SMART || "gpt-5.6-luna",
  vision: process.env.EXPERIENTIAL_MODEL_VISION || "qwen3.8-27b",
  groq: process.env.GROQ_AGENT_MODEL || "openai/gpt-oss-120b",
} as const;

function redactSecrets(value: string) {
  return value
    .replace(/\b(?:gsk|xpl|sk)-?[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]{12,}/gi, "Bearer [REDACTED]")
    .slice(0, 500);
}

function readableError(error: unknown) {
  if (error instanceof Error) return redactSecrets(error.message || error.name);
  return "Provider request failed";
}

async function experientialKey() {
  return process.env.EXPLABS_API_KEY || process.env.EXPERIENTIAL_API_KEY || (await getSecret("experiential_api_key"));
}

async function groqKey() {
  return process.env.GROQ_API_KEY || (await getSecret("groq_api_key"));
}

export async function dgAgentProviderStatus() {
  const [exp, groq] = await Promise.all([experientialKey(), groqKey()]);
  return {
    experiential: Boolean(exp),
    groq: Boolean(groq),
    models: { fast: MODELS.fast, smart: MODELS.smart, vision: MODELS.vision, fallback: MODELS.groq },
  };
}

function primaryModel(mode: DgAgentMode) {
  if (mode === "smart") return MODELS.smart;
  if (mode === "vision" && process.env.DG_AGENT_ALLOW_PAID_VISION === "true") return MODELS.vision;
  if (mode === "vision") return MODELS.smart;
  return MODELS.fast;
}

function normalizeToolCalls(raw: unknown): DgAgentToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const row = item as { id?: unknown; type?: unknown; function?: { name?: unknown; arguments?: unknown } };
    if (row.type !== "function" || typeof row.id !== "string" || typeof row.function?.name !== "string") return [];
    return [{
      id: row.id,
      type: "function" as const,
      function: {
        name: row.function.name,
        arguments: typeof row.function.arguments === "string" ? row.function.arguments : "{}",
      },
    }];
  });
}

async function completeWith(
  provider: DgAgentProvider,
  apiKey: string,
  model: string,
  messages: DgAgentMessage[],
  tools: DgAgentToolDefinition[],
) {
  const client = new OpenAI({
    apiKey,
    baseURL: provider === "experiential" ? EXPERIENTIAL_BASE_URL : GROQ_BASE_URL,
    timeout: 45_000,
    maxRetries: 0,
  });
  const response = await client.chat.completions.create({
    model,
    messages: messages as never,
    tools: tools.length ? (tools as never) : undefined,
    tool_choice: tools.length ? "auto" : undefined,
    max_tokens: 3200,
  });
  const message = response.choices[0]?.message;
  if (!message) throw new Error("Leere Modellantwort.");
  return {
    content: typeof message.content === "string" ? message.content.trim() : "",
    toolCalls: normalizeToolCalls(message.tool_calls),
  };
}

export async function runDgAgentModel(input: {
  messages: DgAgentMessage[];
  tools?: DgAgentToolDefinition[];
  mode?: DgAgentMode;
}): Promise<DgAgentCompletion> {
  const mode = input.mode || "auto";
  const model = primaryModel(mode);
  const tools = input.tools || [];
  const attempts: DgAgentCompletion["attempts"] = [];
  const exp = await experientialKey();

  if (exp) {
    try {
      const result = await completeWith("experiential", exp, model, input.messages, tools);
      attempts.push({ provider: "experiential", model, ok: true });
      return { ...result, provider: "experiential", model, fallbackUsed: false, attempts };
    } catch (error) {
      attempts.push({ provider: "experiential", model, ok: false, error: readableError(error) });
    }
  } else {
    attempts.push({ provider: "experiential", model, ok: false, error: "API-Key nicht konfiguriert" });
  }

  const groq = await groqKey();
  if (!groq) {
    const detail = attempts.map((row) => `${row.provider}/${row.model}: ${row.error || "Fehler"}`).join(" · ");
    throw new Error(`Kein KI-Provider verfügbar. ${detail}`);
  }

  try {
    const result = await completeWith("groq", groq, MODELS.groq, input.messages, tools);
    attempts.push({ provider: "groq", model: MODELS.groq, ok: true });
    return { ...result, provider: "groq", model: MODELS.groq, fallbackUsed: true, attempts };
  } catch (error) {
    attempts.push({ provider: "groq", model: MODELS.groq, ok: false, error: readableError(error) });
    const detail = attempts.map((row) => `${row.provider}/${row.model}: ${row.error || "Fehler"}`).join(" · ");
    throw new Error(`Alle KI-Provider fehlgeschlagen. ${detail}`);
  }
}

export function inferDgAgentMode(message: string): DgAgentMode {
  const text = message.toLowerCase();
  if (/(bild|screenshot|video|visuell|layout|design prüfen|render prüfen)/.test(text)) return "vision";
  if (/(strategie|komplex|analysier|entscheide|priorisier|warum|konzept|kampagne|optimiere)/.test(text)) return "smart";
  return "fast";
}
