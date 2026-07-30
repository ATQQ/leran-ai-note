/**
 * M2 演示页：运行时约束
 *
 * - 可调 maxSteps / timeoutMs / stopOnToolError
 * - 场景：正常循环、maxSteps=1、本地未知工具/非法参数、经模型诱导
 * - 取消按钮 → AbortSignal → Server abort → Trace stopReason=aborted
 * - 密钥只在 Server；本文件不得出现 API Key
 */
import { runSse } from "../shared/shared.js";

const promptEl = document.getElementById("prompt");
const maxStepsEl = document.getElementById("maxSteps");
const timeoutMsEl = document.getElementById("timeoutMs");
const stopOnErrEl = document.getElementById("stopOnToolError");
const streamEl = document.getElementById("stream");
const eventsEl = document.getElementById("events");
const statusEl = document.getElementById("status");
const stopReasonEl = document.getElementById("stopReason");
const lastErrorEl = document.getElementById("lastError");
const traceEl = document.getElementById("trace");
const traceMetaEl = document.getElementById("traceMeta");
const runBtn = document.getElementById("run");
const stopBtn = document.getElementById("stop");
const reloadTraceBtn = document.getElementById("reloadTrace");

/** 当前是否走 localGuard（不调模型） */
let localGuard = null;
let abortController = null;

const SCENARIOS = {
  normal: {
    localGuard: null,
    maxSteps: 8,
    prompt:
      "帮我查一下深圳的天气，再用工具算一下 12 加 30，最后用中文简短总结。",
  },
  max_steps: {
    localGuard: null,
    maxSteps: 1,
    prompt:
      "帮我查一下深圳的天气，再用工具算一下 12 加 30，最后用中文简短总结。",
  },
  unknown_tool: {
    localGuard: "unknown_tool",
    maxSteps: 8,
    prompt: "（本地演示：伪造未知工具 fly_to_moon，不调模型）",
  },
  bad_args: {
    localGuard: "bad_args",
    maxSteps: 8,
    prompt: "（本地演示：伪造 add(a=\"十二\", b=true)，不调模型）",
  },
  induce_bad: {
    localGuard: null,
    maxSteps: 8,
    prompt:
      "请调用 add 工具，但参数必须是 a=\"十二\"（字符串）和 b=true（布尔），不要用数字。然后再总结。",
  },
};

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = "pill" + (cls ? " " + cls : "");
}

function setStopReason(reason) {
  stopReasonEl.textContent = reason || "—";
  const terminal = ["max_steps", "aborted", "timeout", "tool_error", "error"];
  stopReasonEl.className =
    "pill" +
    (reason === "completed"
      ? " ok"
      : terminal.includes(reason)
        ? " err"
        : reason
          ? " warn"
          : "");
}

function appendEvent(line) {
  eventsEl.textContent += line + "\n";
  eventsEl.scrollTop = eventsEl.scrollHeight;
}

function showErrorPayload(payload) {
  lastErrorEl.textContent = JSON.stringify(payload, null, 2);
}

document.getElementById("scenarios").addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-scenario]");
  if (!btn) return;
  const key = btn.getAttribute("data-scenario");
  const cfg = SCENARIOS[key];
  if (!cfg) return;
  localGuard = cfg.localGuard;
  maxStepsEl.value = String(cfg.maxSteps);
  promptEl.value = cfg.prompt;
  setStatus(`场景: ${key}`);
  appendEvent(`[scenario] ${key}` + (cfg.localGuard ? ` localGuard=${cfg.localGuard}` : ""));
});

async function loadTrace() {
  const res = await fetch("/api/trace/latest");
  if (!res.ok) throw new Error("no trace");
  const data = await res.json();
  const stop = data.meta?.stopReason ?? "—";
  setStopReason(stop);
  traceMetaEl.textContent = `stopReason=${stop}`;
  traceMetaEl.className =
    "pill" + (stop === "completed" ? " ok" : stop && stop !== "—" ? " err" : "");

  // 摘要：只展示与守卫相关的 steps
  const lines = (data.steps || [])
    .filter((s) =>
      ["init", "execute_tool", "append_tool_result", "final_answer", "error"].includes(
        s.phase,
      ),
    )
    .map((s) => {
      const err =
        s.payload?.isError || s.payload?.appended?.content?.includes('"error"')
          ? " ⚠"
          : "";
      return `#${s.id} [${s.phase}] ${s.title}${err}\n  ${s.summary}`;
    });
  traceEl.textContent = lines.join("\n\n") || JSON.stringify(data.meta, null, 2);

  // 从 Trace 抽出最近一次错误内容
  for (let i = (data.steps || []).length - 1; i >= 0; i--) {
    const s = data.steps[i];
    if (s.payload?.isError && s.payload?.appended) {
      try {
        showErrorPayload(JSON.parse(s.payload.appended.content));
      } catch {
        showErrorPayload(s.payload.appended.content);
      }
      break;
    }
  }
  return data;
}

reloadTraceBtn.onclick = async () => {
  try {
    await loadTrace();
    setStatus("trace loaded", "ok");
  } catch {
    setStatus("no trace", "err");
  }
};

stopBtn.onclick = () => {
  abortController?.abort();
  appendEvent("[ui] 已请求取消 → AbortSignal");
};

runBtn.onclick = async () => {
  abortController = new AbortController();
  runBtn.disabled = true;
  stopBtn.disabled = false;
  streamEl.textContent = "";
  eventsEl.textContent = "";
  lastErrorEl.textContent = "（尚无）";
  setStopReason("—");
  setStatus("running");

  const maxSteps = Number(maxStepsEl.value) || 8;
  const timeoutRaw = timeoutMsEl.value.trim();
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : undefined;
  const stopOnToolError = stopOnErrEl.checked;

  const body = {
    prompt: promptEl.value,
    maxSteps,
    stopOnToolError,
  };
  if (timeoutMs && timeoutMs > 0) body.timeoutMs = timeoutMs;
  if (localGuard) body.localGuard = localGuard;

  appendEvent(
    `[run] maxSteps=${maxSteps}` +
      (timeoutMs ? ` timeoutMs=${timeoutMs}` : "") +
      ` stopOnToolError=${stopOnToolError}` +
      (localGuard ? ` localGuard=${localGuard}` : ""),
  );

  try {
    await runSse("/api/run", {
      body,
      signal: abortController.signal,
      onEvent: ({ event, data }) => {
        if (event === "meta") {
          appendEvent(
            `[meta] adapter=${data.adapter}` +
              (data.localGuard ? ` guard=${data.localGuard}` : ` model=${data.model}`),
          );
          return;
        }

        if (event === "text_delta") {
          const delta = data?.payload?.delta || data?.summary || "";
          streamEl.textContent += delta;
          streamEl.scrollTop = streamEl.scrollHeight;
          return;
        }

        if (event === "tool_start") {
          appendEvent(
            `[tool_start] ${data.payload?.name} args=${JSON.stringify(data.payload?.arguments)}`,
          );
          return;
        }

        if (event === "tool_end") {
          const isErr = data.payload?.isError;
          appendEvent(`[tool_end] ${data.title}` + (isErr ? " ← ERROR" : ""));
          if (isErr && data.payload?.appended?.content) {
            try {
              showErrorPayload(JSON.parse(data.payload.appended.content));
            } catch {
              showErrorPayload(data.payload.appended.content);
            }
          }
          return;
        }

        if (event === "assistant_message") {
          const tools = data.payload?.toolCalls || [];
          appendEvent(
            `[assistant] ${data.summary}` +
              (tools.length
                ? ` → ${tools.map((c) => c.name).join(", ")}`
                : ""),
          );
          return;
        }

        if (event === "done") {
          setStopReason(data.stopReason || (data.error ? "error" : "done"));
          appendEvent(`[done] stop=${data.stopReason}`);
          if (data.toolResult?.isError) {
            try {
              showErrorPayload(JSON.parse(data.toolResult.content));
            } catch {
              showErrorPayload(data.toolResult);
            }
          }
          if (data.error) setStatus(data.error, "err");
          else setStatus(data.stopReason || "done", data.stopReason === "completed" ? "ok" : "err");
          return;
        }

        if (event === "error") {
          appendEvent(`[error] ${data.summary}`);
          setStatus("error", "err");
          return;
        }

        if (event === "run_start" || event === "run_end") {
          appendEvent(`[${event}] ${data.summary || data.title || ""}`);
          if (event === "run_end" && data.payload?.stopReason) {
            setStopReason(data.payload.stopReason);
          }
          return;
        }

        // stream_detail 等在 M2 页折叠为一行，避免刷屏
        if (event === "stream_detail") {
          const kind = data.payload?.kind;
          if (kind === "tool_parse_done" || kind === "text_summary") {
            appendEvent(`[stream] ${data.summary}`);
          }
          return;
        }

        appendEvent(`[${event}] ${data.title || data.summary || ""}`);
      },
    });

    try {
      await loadTrace();
    } catch {
      /* 尚无文件时忽略 */
    }
  } catch (err) {
    if (err?.name !== "AbortError") {
      appendEvent(String(err));
      setStatus("failed", "err");
      setStopReason("error");
    } else {
      setStatus("aborted", "err");
      setStopReason("aborted");
      appendEvent("[ui] AbortError（连接已断开）");
      try {
        await loadTrace();
      } catch {
        /* ignore */
      }
    }
  } finally {
    runBtn.disabled = false;
    stopBtn.disabled = true;
    // 场景用过一次后保留 localGuard，直到用户点别的场景
  }
};
