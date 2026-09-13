import {
  inferDgAgentMode,
  runDgAgentModel,
  type DgAgentMessage,
  type DgAgentMode,
} from "@/lib/dg-agent-provider";
import {
  DG_AGENT_TOOL_DEFINITIONS,
  dgAgentToolNeedsApproval,
  dgAgentToolRisk,
  executeDgAgentTool,
  validateDgAgentToolArgs,
} from "@/lib/dg-agent-tools";
import {
  appendAgentMessage,
  createPendingAgentAction,
  getOrCreateAgentThread,
  listPendingAgentActions,
  loadAgentHistory,
  recordExecutedAgentAction,
} from "@/lib/dg-agent-store";

const SYSTEM_PROMPT = `Du bist DG Core, Raphaels operativer KI-Agent im Digitale Gewinner Outbound OS.

Dein Job: echte Systemdaten verstehen, die nächsten sinnvollen Schritte finden und erlaubte Tools zuverlässig ausführen. Du antwortest auf Deutsch, knapp, konkret und ohne Business-Bla-Bla.

HARTE REGELN:
1. Behaupte niemals, dass etwas erledigt, gesendet, analysiert oder gefunden wurde, wenn kein Tool-Ergebnis das bestätigt.
2. Erfinde niemals Leads, Website-Probleme, Kennzahlen, Ansprechpartner, E-Mails, Antworten oder Termine.
3. Externe Kontaktaufnahme ist ein Hochrisiko-Schritt. Tools mit Freigabepflicht dürfen nur als Freigabe angelegt werden. Du kannst niemals deine eigene Freigabe erteilen.
4. Do-not-contact, Suppressions, Antworten, Mailbox-Limits, Versandfenster, Asset-Readiness und technische Gates dürfen niemals umgangen werden.
5. Keine Deployments, Git-Pushes, Commits, Produktionsmigrationen oder Code-Releases. Dieser Agent steuert Sales-OS-Funktionen, nicht Deployment-Infrastruktur.
6. Secrets/API-Keys niemals anzeigen, zitieren oder in Notizen schreiben.
7. Nutze bevorzugt read-only Tools, bevor du etwas änderst. Interne CRM-Änderungen müssen nachvollziehbar und zweckmäßig sein.
8. Wenn eine externe Aktion eine Freigabe braucht, sag Raphael exakt WAS passieren würde und warte auf den Freigabe-Button.
9. Wenn Daten fehlen, sage das offen. Keine Vermutungen als Fakten.
10. Raphael möchte Geschwindigkeit: führe sichere Schritte selbst aus statt ihn mit unnötigen Rückfragen zu blockieren.

Du bist kein Chatbot-Dekoobjekt, sondern der Operator des Systems. Priorisiere Umsatzchancen, saubere Daten, Deliverability und konkrete nächste Schritte.`;

function safeJson(raw: string) {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function summarizeToolResult(value: unknown) {
  const raw = JSON.stringify(value);
  return raw.length <= 12_000 ? raw : `${raw.slice(0, 12_000)}…[gekürzt]`;
}

export async function runDgAgent(input: {
  message: string;
  threadId?: string;
  mode?: DgAgentMode;
  workspace?: string;
}) {
  const workspace = input.workspace || "default";
  const threadId = await getOrCreateAgentThread(input.threadId, workspace);
  const history = await loadAgentHistory(threadId, 14, workspace);
  await appendAgentMessage(threadId, "user", input.message, {}, workspace);

  const messages: DgAgentMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((row) => ({ role: row.role, content: row.content } as DgAgentMessage)),
    { role: "user", content: input.message },
  ];
  const mode = input.mode && input.mode !== "auto" ? input.mode : inferDgAgentMode(input.message);
  const actionSummaries: Array<{ id: string; tool: string; status: string; risk: string }> = [];
  let provider = "";
  let model = "";
  let fallbackUsed = false;
  let finalText = "";

  for (let round = 0; round < 6; round += 1) {
    const completion = await runDgAgentModel({ messages, tools: DG_AGENT_TOOL_DEFINITIONS, mode });
    provider = completion.provider;
    model = completion.model;
    fallbackUsed = completion.fallbackUsed;

    if (!completion.toolCalls.length) {
      finalText = completion.content || "Erledigt.";
      break;
    }

    messages.push({ role: "assistant", content: completion.content || null, tool_calls: completion.toolCalls });

    for (const call of completion.toolCalls) {
      const name = call.function.name;
      const rawArgs = safeJson(call.function.arguments);
      let toolContent = "";
      try {
        const args = validateDgAgentToolArgs(name, rawArgs) as Record<string, unknown>;
        const risk = dgAgentToolRisk(name) || "safe";
        if (dgAgentToolNeedsApproval(name)) {
          const actionId = await createPendingAgentAction({ threadId, toolName: name, args, risk }, workspace);
          actionSummaries.push({ id: actionId, tool: name, status: "pending_approval", risk });
          toolContent = JSON.stringify({ ok: false, requiresApproval: true, actionId, tool: name, message: "Nicht ausgeführt. Raphael muss diese externe Aktion freigeben." });
        } else {
          const result = await executeDgAgentTool(name, args, workspace);
          const actionId = await recordExecutedAgentAction({ threadId, toolName: name, args, risk, result }, workspace);
          actionSummaries.push({ id: actionId, tool: name, status: "executed", risk });
          toolContent = summarizeToolResult({ ok: true, result });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Tool fehlgeschlagen.";
        const actionId = await recordExecutedAgentAction({ threadId, toolName: name, args: rawArgs, risk: dgAgentToolRisk(name) || "safe", error: message }, workspace);
        actionSummaries.push({ id: actionId, tool: name, status: "failed", risk: dgAgentToolRisk(name) || "safe" });
        toolContent = JSON.stringify({ ok: false, error: message });
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: toolContent });
    }
  }

  if (!finalText) finalText = "Ich habe die sicheren Schritte verarbeitet. Für den Rest brauche ich entweder eine Freigabe oder einen weiteren Befehl.";
  await appendAgentMessage(threadId, "assistant", finalText, { provider, model, fallbackUsed, actions: actionSummaries }, workspace);
  const pending = await listPendingAgentActions(threadId, workspace);

  return {
    threadId,
    reply: finalText,
    provider,
    model,
    fallbackUsed,
    mode,
    actions: actionSummaries,
    pendingApprovals: pending.map((row) => ({ id: row.id, tool: row.tool_name, args: row.args, risk: row.risk, expiresAt: row.expires_at })),
  };
}
