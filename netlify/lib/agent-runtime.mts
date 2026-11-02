import Anthropic from "@anthropic-ai/sdk";
import { updateBid, now, type TraceStep } from "./store.mts";

// Netlify AI Gateway injects ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL at runtime,
// so the SDK needs no key in code. Model IDs change over time, so we try a short
// ordered list and remember the first one the gateway accepts.
const MODEL_CANDIDATES = [
  Netlify.env.get("BIDDESK_MODEL"),
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
].filter(Boolean) as string[];

let workingModel: string | null = null;

export type ToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  // Return any JSON-able value. Throwing returns an error to the model as a tool error.
  run: (input: any) => Promise<unknown> | unknown;
};

export type AgentSpec = {
  name: string; // "Intake Agent"
  system: string;
  tools: ToolDef[];
  finalTool: ToolDef; // calling this ends the loop; it may return {error} to make the agent retry
  maxTurns: number;
};

async function createMessage(client: Anthropic, params: any): Promise<{ res: any; model: string }> {
  const candidates = workingModel ? [workingModel] : MODEL_CANDIDATES;
  let lastErr: unknown;
  for (const model of candidates) {
    try {
      const res = await client.messages.create({ ...params, model });
      workingModel = model;
      return { res, model };
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message ?? err);
      const modelProblem = err?.status === 404 || (err?.status === 400 && /model/i.test(msg));
      if (!modelProblem) throw err;
    }
  }
  throw lastErr;
}

// Generic tool-use loop. The agent decides which tools to call and in what order;
// the loop stops when the agent calls its final tool successfully, or at maxTurns.
export async function runAgent(spec: AgentSpec, bidId: string, userInput: string): Promise<{ output: any; model: string }> {
  if (!Netlify.env.get("ANTHROPIC_BASE_URL") && !Netlify.env.get("ANTHROPIC_API_KEY")) {
    throw new Error("AI Gateway is not active on this site (no Anthropic credentials injected).");
  }
  const client = new Anthropic();
  const allTools = [...spec.tools, spec.finalTool];
  const toolByName = new Map(allTools.map((t) => [t.name, t]));
  const apiTools = allTools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  const messages: any[] = [{ role: "user", content: userInput }];
  const trace = (s: Omit<TraceStep, "agent" | "at">) =>
    updateBid(bidId, (b) => b.trace.push({ ...s, agent: spec.name, at: now() }));

  let model = "";
  for (let turn = 0; turn < spec.maxTurns; turn++) {
    const lastTurn = turn === spec.maxTurns - 1;
    const { res, model: m } = await createMessage(client, {
      max_tokens: 4096,
      system: spec.system,
      tools: apiTools,
      // On the last allowed turn, force the final tool so the loop always terminates with output.
      tool_choice: lastTurn ? { type: "tool", name: spec.finalTool.name } : { type: "auto" },
      messages,
    });
    model = m;
    messages.push({ role: "assistant", content: res.content });

    const text = res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
    if (text) await trace({ kind: "thinking", text: text.slice(0, 600) });

    const uses = res.content.filter((b: any) => b.type === "tool_use");
    if (uses.length === 0) {
      messages.push({ role: "user", content: `Continue. When you are done, call ${spec.finalTool.name}.` });
      continue;
    }

    const results: any[] = [];
    for (const use of uses) {
      const tool = toolByName.get(use.name);
      const isFinal = use.name === spec.finalTool.name;
      await trace({ kind: isFinal ? "final" : "tool_call", tool: use.name, input: use.input });
      let output: any;
      let isError = false;
      try {
        if (!tool) throw new Error(`Unknown tool ${use.name}`);
        output = await tool.run(use.input);
        if (output && typeof output === "object" && "error" in output) isError = true;
      } catch (e: any) {
        output = { error: String(e?.message ?? e) };
        isError = true;
      }
      if (isFinal && !isError) return { output, model };
      if (!isFinal) await trace({ kind: "tool_result", tool: use.name, output });
      if (isFinal && isError) await trace({ kind: "error", tool: use.name, text: `Rejected: ${output.error}` });
      results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(output), is_error: isError });
    }
    messages.push({ role: "user", content: results });
  }
  throw new Error(`${spec.name} did not produce a valid result within ${spec.maxTurns} turns.`);
}
