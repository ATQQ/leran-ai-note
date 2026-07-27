/**
 * 调用轨迹记录：每步写入，结束后落盘 JSON（脱敏）
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

function redactDeep(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    if (/^sk-[a-zA-Z0-9_-]{8,}/.test(value)) return "[REDACTED_KEY]";
    if (value.length > 8 && /api[_-]?key|bearer|token/i.test(value) && /^[A-Za-z0-9._-]{20,}$/.test(value)) {
      return "[REDACTED]";
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(redactDeep);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
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

export class TraceRecorder {
  constructor({ provider, model, baseUrl, userAgent, toolsSchema }) {
    this.provider = provider;
    this.steps = [];
    this.meta = {
      provider,
      model,
      baseUrl,
      userAgent,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    this.toolsSchema = redactDeep(toolsSchema);
  }

  addStep({
    phase,
    title,
    summary,
    actor = "harness",
    direction = "local",
    payload = null,
    note = null,
  }) {
    const step = {
      id: this.steps.length + 1,
      phase,
      title,
      summary,
      actor,
      direction,
      note,
      payload: redactDeep(payload),
      at: new Date().toISOString(),
    };
    this.steps.push(step);
    return step;
  }

  finish(extra = {}) {
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
          tool: "本地工具实现（mock）",
        },
        directions: {
          out: "发出（Harness → Model / Tool）",
          in: "收回（Model / Tool → Harness）",
          local: "本地处理",
        },
      },
    };
  }

  /** @returns {string} 写出的绝对路径 */
  write(basename) {
    const dir = resolve(ROOT, "traces");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const latest = resolve(dir, `${basename}-latest.json`);
    const stamped = resolve(dir, `${basename}-${stamp}.json`);
    const json = JSON.stringify(this.toJSON(), null, 2);
    writeFileSync(latest, json, "utf8");
    writeFileSync(stamped, json, "utf8");
    return latest;
  }
}
