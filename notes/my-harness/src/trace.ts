import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RunEvent } from "./types.ts";

function redactDeep(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    if (/^sk-[a-zA-Z0-9_-]{8,}/.test(value)) return "[REDACTED_KEY]";
    if (
      value.length > 8 &&
      /api[_-]?key|bearer|token/i.test(value) &&
      /^[A-Za-z0-9._-]{20,}$/.test(value)
    ) {
      return "[REDACTED]";
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(redactDeep);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/authorization|api[_-]?key|x-api-key|token|secret|password/i.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactDeep(v);
      }
    }
    return out;
  }
  return value;
}

export type TraceStep = {
  id: number;
  phase: string;
  title: string;
  summary: string;
  actor: string;
  direction: string;
  note: string | null;
  payload: unknown;
  at: string;
};

export class TraceRecorder {
  provider: string;
  steps: TraceStep[] = [];
  meta: Record<string, unknown>;
  toolsSchema: unknown;

  constructor(opts: {
    provider: string;
    model: string;
    baseUrl: string;
    toolsSchema: unknown;
  }) {
    this.provider = opts.provider;
    this.meta = {
      provider: opts.provider,
      model: opts.model,
      baseUrl: opts.baseUrl,
      startedAt: new Date().toISOString(),
      finishedAt: null as string | null,
    };
    this.toolsSchema = redactDeep(opts.toolsSchema);
  }

  addFromEvent(event: RunEvent): TraceStep {
    // 流式 text_delta 汇总进 assistant，避免 Trace 刷屏
    if (event.type === "text_delta") {
      return {
        id: this.steps.length,
        phase: event.phase,
        title: event.title,
        summary: event.summary,
        actor: event.actor,
        direction: event.direction,
        note: event.note ?? null,
        payload: null,
        at: event.at ?? new Date().toISOString(),
      };
    }
    return this.addStep({
      phase: event.phase,
      title: event.title,
      summary: event.summary,
      actor: event.actor,
      direction: event.direction,
      payload: event.payload,
      note: event.note,
    });
  }

  addStep(input: {
    phase: string;
    title: string;
    summary: string;
    actor?: string;
    direction?: string;
    payload?: unknown;
    note?: string | null;
  }): TraceStep {
    const step: TraceStep = {
      id: this.steps.length + 1,
      phase: input.phase,
      title: input.title,
      summary: input.summary,
      actor: input.actor ?? "harness",
      direction: input.direction ?? "local",
      note: input.note ?? null,
      payload: redactDeep(input.payload ?? null),
      at: new Date().toISOString(),
    };
    this.steps.push(step);
    return step;
  }

  finish(extra: Record<string, unknown> = {}): void {
    this.meta.finishedAt = new Date().toISOString();
    Object.assign(this.meta, extra);
  }

  toJSON() {
    return {
      version: 1,
      meta: this.meta,
      toolsSchema: this.toolsSchema,
      steps: this.steps,
      legend: {
        actors: {
          harness: "应用侧 / 运行时（组请求、执行工具、回灌）",
          model: "大模型（推理 / 产出 tool_calls 或最终文本）",
          tool: "工具实现（本地 mock 或 MCP）",
        },
        directions: {
          out: "发出（Harness → Model / Tool）",
          in: "收回（Model / Tool → Harness）",
          local: "本地处理",
        },
      },
    };
  }

  write(tracesDir: string, basename: string): string {
    mkdirSync(tracesDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const latest = resolve(tracesDir, `${basename}-latest.json`);
    const stamped = resolve(tracesDir, `${basename}-${stamp}.json`);
    const json = JSON.stringify(this.toJSON(), null, 2);
    writeFileSync(latest, json, "utf8");
    writeFileSync(stamped, json, "utf8");
    return latest;
  }
}
