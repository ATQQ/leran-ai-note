/**
 * M3 演示页：可构造历史 + 步骤拆解 + 真实出站 JSON
 *
 * 学习路径：
 * 1. 在页面编辑 history（UnifiedMessage）
 * 2. 选 assemble 策略后运行
 * 3. 步骤卡里点 llm_request → 看裁剪前/后 + OpenAI body
 */
import { runSse } from "../shared/shared.js";
import { createHistoryEditor } from "./history.js";
import {
  createStepsView,
  renderJsonCompare,
  renderStrategyHelp,
} from "./steps.js";

const promptEl = document.getElementById("prompt");
const systemEl = document.getElementById("systemPrompt");
const strategyEl = document.getElementById("strategy");
const recentNEl = document.getElementById("recentN");
const maxCharsEl = document.getElementById("maxChars");
const strategyHelpEl = document.getElementById("strategyHelp");
const streamEl = document.getElementById("stream");
const eventsEl = document.getElementById("events");
const statusEl = document.getElementById("status");
const runBtn = document.getElementById("run");
const stopBtn = document.getElementById("stop");
const reloadTraceBtn = document.getElementById("reloadTrace");

const jsonEls = {
  jsonBefore: document.getElementById("jsonBefore"),
  jsonAfter: document.getElementById("jsonAfter"),
  jsonOpenAI: document.getElementById("jsonOpenAI"),
  jsonRound: document.getElementById("jsonRound"),
  ctxStats: document.getElementById("ctxStats"),
  trimDetail: document.getElementById("trimDetail"),
};

function refreshStrategyHelp() {
  renderStrategyHelp(strategyHelpEl, strategyEl.value, {
    recentN: Number(recentNEl.value) || 0,
    maxChars: Number(maxCharsEl.value) || 2000,
  });
}

strategyEl.onchange = refreshStrategyHelp;
recentNEl.oninput = refreshStrategyHelp;
maxCharsEl.oninput = refreshStrategyHelp;
refreshStrategyHelp();

let abortController = null;

const history = createHistoryEditor({
  listEl: document.getElementById("historyList"),
  countEl: document.getElementById("historyCount"),
});

const stepsView = createStepsView(document.getElementById("steps"), (step) => {
  renderJsonCompare(jsonEls, step);
});

document.querySelector(".presets")?.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-preset]");
  if (!btn) return;
  const key = btn.getAttribute("data-preset");
  history.presets[key]?.();
});

document.getElementById("addUser").onclick = () => history.add("user", "");
document.getElementById("addAssistant").onclick = () =>
  history.add("assistant", "");

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = "pill" + (cls ? " " + cls : "");
}

function appendEvent(line) {
  eventsEl.textContent += line + "\n";
  eventsEl.scrollTop = eventsEl.scrollHeight;
}

async function loadTrace() {
  const res = await fetch("/api/trace/latest");
  if (!res.ok) throw new Error("no trace");
  const data = await res.json();
  stepsView.fromTraceSteps(data.steps || []);
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

stopBtn.onclick = () => abortController?.abort();

runBtn.onclick = async () => {
  abortController = new AbortController();
  runBtn.disabled = true;
  stopBtn.disabled = false;
  streamEl.textContent = "";
  eventsEl.textContent = "";
  stepsView.clear();
  jsonEls.jsonBefore.textContent = "—";
  jsonEls.jsonAfter.textContent = "—";
  jsonEls.jsonOpenAI.textContent = "—";
  jsonEls.ctxStats.textContent = "运行中…";
  setStatus("running");

  const body = {
    prompt: promptEl.value,
    systemPrompt: systemEl.value,
    maxSteps: 6,
    contextStrategy: strategyEl.value,
    recentN: Number(recentNEl.value) || 0,
    maxChars: Number(maxCharsEl.value) || 2000,
    // 页面构造的历史优先；不再用 seedPairs
    history: history.toPayload(),
  };

  appendEvent(
    `[run] strategy=${body.contextStrategy} history=${body.history.length} recentN=${body.recentN}`,
  );

  try {
    await runSse("/api/run", {
      body,
      signal: abortController.signal,
      onEvent: ({ event, data }) => {
        if (event === "meta") {
          appendEvent(
            `[meta] model=${data.model} source=${data.historySource} initial=${data.initialMessageCount}`,
          );
          stepsView.append("meta", {
            title: "连接元信息",
            summary: `model=${data.model} · historySource=${data.historySource} · messages=${data.initialMessageCount}`,
            phase: "meta",
            payload: data,
          });
          return;
        }

        // 步骤卡：核心事件都进拆解区
        if (
          event === "run_start" ||
          event === "llm_request" ||
          event === "assistant_message" ||
          event === "tool_start" ||
          event === "tool_end" ||
          event === "run_end" ||
          event === "error" ||
          event === "stream_detail"
        ) {
          stepsView.append(event, data);
        }

        if (event === "llm_request") {
          appendEvent(`[llm] ${data.summary}`);
          return;
        }

        if (event === "text_delta") {
          streamEl.textContent += data?.payload?.delta || data?.summary || "";
          streamEl.scrollTop = streamEl.scrollHeight;
          return;
        }

        if (event === "assistant_message") {
          appendEvent(`[assistant] ${data.summary}`);
          return;
        }

        if (event === "tool_start" || event === "tool_end") {
          appendEvent(`[${event}] ${data.title}`);
          return;
        }

        if (event === "done") {
          appendEvent(`[done] stop=${data.stopReason}`);
          setStatus(data.stopReason || "done", data.error ? "err" : "ok");
          stepsView.append("done", {
            title: "SSE done",
            summary: `stopReason=${data.stopReason}`,
            phase: "done",
            payload: data,
          });
          return;
        }

        if (event === "error") {
          appendEvent(`[error] ${data.summary}`);
          setStatus("error", "err");
          return;
        }

        if (event === "run_start" || event === "run_end") {
          appendEvent(`[${event}] ${data.summary || ""}`);
        }
      },
    });
  } catch (err) {
    if (err?.name !== "AbortError") {
      appendEvent(String(err));
      setStatus("failed", "err");
    } else {
      setStatus("aborted", "err");
    }
  } finally {
    runBtn.disabled = false;
    stopBtn.disabled = true;
  }
};
