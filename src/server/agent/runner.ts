import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { World } from "@/domain/types";
import type { Store, Trigger } from "../store";
import { SYSTEM_PROMPT, wakeMessage } from "./prompt";
import { caseSnapshot } from "./snapshot";
import { anthropicToolDefs, executeTool } from "./tools";
import { SCRIPTS } from "./scripted";

export const MODEL = process.env.CARRYPAY_MODEL || "claude-opus-5-5";
const EFFORT = (process.env.CARRYPAY_EFFORT || "medium") as "low" | "medium" | "high" | "xhigh" | "max";
const MAX_STEPS = 24;
const STEP_DELAY_SCRIPTED = Number(process.env.CARRYPAY_STEP_DELAY_MS ?? 700);
const STEP_DELAY_REPLAY = Number(process.env.CARRYPAY_STEP_DELAY_MS ?? 850);
const REC_DIR = path.join(process.env.CARRYPAY_DATA_DIR || path.join(process.cwd(), ".data"), "recordings");

export interface RecordedStep {
  tool: string;
  input: Record<string, unknown>;
  thinking?: string;
}
export interface RecordedRun {
  triggers: { reason: string; detail?: string }[];
  steps: RecordedStep[];
  finalText?: string;
}
export interface Recording {
  scenarioId: string;
  model: string;
  createdAt: string;
  runs: RecordedRun[];
}

export function hasApiCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export class AgentRunner {
  private pending = new Map<string, Trigger[]>();
  private busy = false;
  private recording: Recording | null = null;
  private replayCursor = new Set<number>();
  private replaySource: Recording | null = null;
  private scriptedCursor = new Set<number>();

  private onTrigger = (t: Trigger) => this.enqueue(t);

  constructor(private store: Store) {
    store.on("trigger", this.onTrigger);
  }

  /** Detach from the store (used when dev hot-reload swaps in new code). */
  dispose() {
    this.store.off("trigger", this.onTrigger);
  }

  get isBusy() {
    return this.busy || this.pending.size > 0;
  }

  /** Called on scenario reset. */
  resetSession() {
    this.pending.clear();
    this.replayCursor.clear();
    this.scriptedCursor.clear();
    const w = this.store.world;
    this.recording = { scenarioId: w.scenarioId, model: MODEL, createdAt: new Date().toISOString(), runs: [] };
    this.replaySource = loadLatestRecording(w.scenarioId);
  }

  enqueue(t: Trigger) {
    const list = this.pending.get(t.caseId) ?? [];
    list.push(t);
    this.pending.set(t.caseId, list);
    void this.pump();
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.pending.size > 0) {
        const [caseId, triggers] = this.pending.entries().next().value as [string, Trigger[]];
        this.pending.delete(caseId);
        if (this.store.world.agent.killSwitch) continue;
        await this.runCase(caseId, triggers);
      }
    } finally {
      this.busy = false;
      this.store.mutate((w) => {
        if (w.agent.status === "working") w.agent.status = "idle";
        w.agent.currentCaseId = undefined;
      });
    }
  }

  private async runCase(caseId: string, triggers: Trigger[]) {
    const mode = this.store.world.agent.mode;
    this.store.mutate((w) => {
      w.agent.status = "working";
      w.agent.currentCaseId = caseId;
      w.agent.lastError = undefined;
      w.agent.runs += 1;
    });
    this.store.log({
      actor: "system",
      type: "agent.wake",
      caseId,
      data: { mode, triggers: triggers.map((t) => ({ reason: t.reason, detail: t.detail })) },
    });
    try {
      if (mode === "live") await this.runLive(caseId, triggers);
      else if (mode === "replay") await this.runReplay(caseId, triggers);
      else await this.runScripted(caseId, triggers);
    } catch (err) {
      const msg = describeError(err);
      this.store.mutate((w) => (w.agent.lastError = msg));
      this.store.log({ actor: "system", type: "agent.error", caseId, data: { error: msg } });
    }
    this.store.log({ actor: "system", type: "agent.sleep", caseId, data: {} });
  }

  // -------------------------------------------------------------------------
  // Live: Claude decides

  private async runLive(caseId: string, triggers: Trigger[]) {
    if (!hasApiCredentials()) {
      throw new Error("No ANTHROPIC_API_KEY set. Add it to .env.local, or switch the agent to Replay or Scripted mode in the Director.");
    }
    const client = new Anthropic();
    const tools = anthropicToolDefs();
    const run: RecordedRun = { triggers: triggers.map((t) => ({ reason: t.reason, detail: t.detail })), steps: [] };
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      { role: "user", content: wakeMessage(triggers, caseSnapshot(this.store.world, caseId)) },
    ];

    for (let step = 0; step < MAX_STEPS; step++) {
      if (this.store.world.agent.killSwitch) break;
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: EFFORT },
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools,
        messages,
      });

      if (response.stop_reason === "refusal") {
        throw new Error(`Model declined (${response.stop_details?.category ?? "unknown"}).`);
      }

      const thinking = response.content
        .filter((b): b is Anthropic.Beta.BetaThinkingBlock => b.type === "thinking")
        .map((b) => b.thinking)
        .filter(Boolean)
        .join("\n");
      if (thinking) this.store.log({ actor: "agent", type: "agent.thinking", caseId, data: { summary: thinking.slice(0, 1500) } });

      messages.push({ role: "assistant", content: response.content });

      const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (response.stop_reason === "max_tokens") throw new Error("Model output was cut off (max_tokens).");
      if (toolUses.length === 0) {
        const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n");
        run.finalText = text;
        if (text.trim()) this.store.log({ actor: "agent", type: "agent.summary", caseId, data: { text: text.slice(0, 1500) } });
        break;
      }

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const input = (tu.input ?? {}) as Record<string, unknown>;
        run.steps.push({ tool: tu.name, input, thinking: thinking || undefined });
        const output = executeTool(tu.name, input, { store: this.store, caseId });
        results.push({ type: "tool_result", tool_use_id: tu.id, content: output });
      }
      messages.push({ role: "user", content: results });
    }

    this.saveRun(run);
  }

  private saveRun(run: RecordedRun) {
    if (!this.recording) this.resetSession();
    this.recording!.runs.push(run);
    fs.mkdirSync(REC_DIR, { recursive: true });
    const file = path.join(REC_DIR, `${this.recording!.scenarioId}-${this.recording!.createdAt.replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(this.recording, null, 2));
  }

  // -------------------------------------------------------------------------
  // Replay: decisions from a recorded live run, executed for real in the sandbox

  private async runReplay(caseId: string, triggers: Trigger[]) {
    const rec = this.replaySource ?? loadLatestRecording(this.store.world.scenarioId);
    this.replaySource = rec;
    if (!rec) throw new Error("No recorded live run for this scenario yet. Run it once in Live mode to record one.");
    const reasons = triggers.map((t) => t.reason).sort().join(",");
    let idx = rec.runs.findIndex((r, i) => !this.replayCursor.has(i) && r.triggers.map((t) => t.reason).sort().join(",") === reasons);
    if (idx < 0) idx = rec.runs.findIndex((_r, i) => !this.replayCursor.has(i));
    if (idx < 0) throw new Error("The recording has no more steps for this point in the scenario.");
    this.replayCursor.add(idx);
    let lastThinking = "";
    for (const step of rec.runs[idx].steps) {
      if (this.store.world.agent.killSwitch) break;
      if (step.thinking && step.thinking !== lastThinking) {
        this.store.log({ actor: "agent", type: "agent.thinking", caseId, data: { summary: step.thinking.slice(0, 1500), replayed: true } });
        lastThinking = step.thinking;
      }
      await sleep(STEP_DELAY_REPLAY);
      executeTool(step.tool, step.input, { store: this.store, caseId });
    }
  }

  // -------------------------------------------------------------------------
  // Scripted: hand-written plan for development without an API key (no AI)

  private async runScripted(caseId: string, triggers: Trigger[]) {
    const script = SCRIPTS[this.store.world.scenarioId];
    if (!script) throw new Error("No scripted plan for this scenario.");
    const idx = script.findIndex((s, i) => !this.scriptedCursor.has(i) && s.when(triggers, this.store.world));
    if (idx < 0) return;
    this.scriptedCursor.add(idx);
    for (const make of script[idx].steps) {
      if (this.store.world.agent.killSwitch) break;
      const step = make(this.store.world, caseId);
      if (!step) continue;
      await sleep(STEP_DELAY_SCRIPTED);
      executeTool(step.tool, step.input, { store: this.store, caseId });
    }
  }
}

export interface ScriptedRun {
  when: (triggers: Trigger[], w: World) => boolean;
  steps: ((w: World, caseId: string) => RecordedStep | null)[];
}

function loadLatestRecording(scenarioId: string): Recording | null {
  if (!fs.existsSync(REC_DIR)) return null;
  const files = fs.readdirSync(REC_DIR).filter((f) => f.startsWith(scenarioId + "-") && f.endsWith(".json")).sort();
  for (const f of files.reverse()) {
    const rec = JSON.parse(fs.readFileSync(path.join(REC_DIR, f), "utf8")) as Recording;
    if (rec.runs.length > 0) return rec;
  }
  return null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the Anthropic API. Try again shortly.";
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the Anthropic API (network).";
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
