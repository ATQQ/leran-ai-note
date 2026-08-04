/**
 * M8：并行 tool_calls / 子 Agent 演示
 */
import { runSse } from "../shared/shared.js";

const promptEl = document.getElementById("prompt");
const toolExecutionEl = document.getElementById("toolExecution");
const maxStepsEl = document.getElementById("maxSteps");
const streamEl = document.getElementById("stream");
const timelineEl = document.getElementById("timeline");
const eventsEl = document.getElementById("events");
const statusEl = document.getElementById("status");
const timingEl = document.getElementById("timing");
const runBtn = document.getElementById("run");
const stopBtn = document.getElementById("stop");

const PROMPTS = {
  parallel:
    "请同时查深圳和上海的天气，并用工具计算 12 加 30，最后用中文一句话总结。",
  sub: "请用 run_subagent 完成子任务：查北京天气并计算 7 加 8，子 Agent 返回结论后你再用中文复述。",
  mix: "先用 run_subagent 查深圳天气，你自己再用 add 算 100 加 23，最后总结。",
};

let abortController = null;
let runStartedAt = 0;

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = "pill" + (cls ? " " + cls : "");
}

function append(el, line) {
  el.textContent += line + "\n";
  el.scrollTop = el.scrollHeight;
}

document.querySelectorAll("[data-prompt]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const k = btn.getAttribute("data-prompt");
    if (k && PROMPTS[k]) promptEl.value = PROMPTS[k];
  });
});

stopBtn.onclick = () => abortController?.abort();

runBtn.onclick = async () => {
  streamEl.textContent = "";
  timelineEl.textContent = "";
  eventsEl.textContent = "";
  setStatus("running…");
  timingEl.textContent = "…";
  runBtn.disabled = true;
  stopBtn.disabled = false;
  abortController = new AbortController();
  runStartedAt = Date.now();

  try {
    await runSse("/api/run", {
      body: {
        prompt: promptEl.value,
        toolExecution: toolExecutionEl.value,
        maxSteps: Number(maxStepsEl.value) || 8,
        systemPrompt:
          "你是助手。可以一次发起多个工具调用。" +
          "需要天气或加法时必须调用工具；子任务可用 run_subagent。" +
          "不要编造工具结果。",
      },
      signal: abortController.signal,
      onEvent: ({ event, data }) => {
        if (event === "meta") {
          append(
            eventsEl,
            "[meta] toolExecution=" +
              data.toolExecution +
              " tools=" +
              JSON.stringify(data.tools || []),
          );
          return;
        }

        const type = data?.type || event;
        const sub = data?.payload?.subagent || data?.payload?.parentToolCallId;
        const prefix = sub ? "  [子] " : "";

        if (type === "text_delta") {
          streamEl.textContent += data?.payload?.delta ?? data?.summary ?? "";
        }

        if (
          type === "tool_start" ||
          type === "tool_end" ||
          type === "subagent_start" ||
          type === "subagent_end"
        ) {
          const p = data?.payload || {};
          const dur =
            typeof p.durationMs === "number" ? ` · ${p.durationMs}ms` : "";
          const par = p.parallel ? " · parallel" : "";
          append(
            timelineEl,
            `${prefix}${type} ${data?.title || ""}` +
              (p.name ? ` name=${p.name}` : "") +
              dur +
              par +
              (p.startedAt && p.endedAt
                ? ` · [${p.startedAt % 100000}-${p.endedAt % 100000}]`
                : ""),
          );
        }

        if (data?.type) {
          append(
            eventsEl,
            `${prefix}[${data.type}] ${(data.title || "").slice(0, 60)} · ${(data.summary || "").slice(0, 80)}`,
          );
        }

        if (event === "done") {
          const ms = Date.now() - runStartedAt;
          timingEl.textContent = ms + "ms";
          timingEl.className = "pill ok";
          setStatus(
            "done · " + (data?.stopReason || "ok"),
            data?.error ? "err" : "ok",
          );
        }
      },
    });
  } catch (err) {
    if (err?.name === "AbortError") setStatus("aborted", "warn");
    else setStatus(String(err?.message || err), "err");
  } finally {
    runBtn.disabled = false;
    stopBtn.disabled = true;
    abortController = null;
  }
};
