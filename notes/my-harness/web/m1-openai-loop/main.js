/**
 * M1 演示页逻辑：OpenAI 流式循环 + 协议时间线 + Trace 卡片回放
 *
 * 页面只负责：
 * - 收集 prompt、发起 POST /api/run
 * - 按「轮次」展示流式文本
 * - 协议时间线展示 stream_detail（工具碎片拼接过程）
 * - 加载 Trace 后重建轮次 + 时间线，并以卡片回放步骤
 *
 * 密钥与模型调用全部在 Server；本文件不得出现 API Key。
 */
import { runSse } from "../shared/shared.js";
import {
  appendTimelineCard,
  clearTimeline,
  rebuildTimelineFromSteps,
} from "./timeline.js";
import {
  rebuildStreamFromSteps,
  rebuildEventsFromSteps,
  renderTraceChrome,
} from "./trace-view.js";

const promptEl = document.getElementById("prompt");
const streamEl = document.getElementById("stream");
const timelineEl = document.getElementById("timeline");
const eventsEl = document.getElementById("events");
const statusEl = document.getElementById("status");
const traceEl = document.getElementById("trace");
const traceRailEl = document.getElementById("traceRail");
const stepLabel = document.getElementById("stepLabel");
const runBtn = document.getElementById("run");
const stopBtn = document.getElementById("stop");
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");
const reloadTraceBtn = document.getElementById("reloadTrace");

/** 当前运行的 AbortController；点「取消」时 abort，Server 会停 loop */
let abortController = null;
/** Trace steps 与当前回放下标 */
let steps = [];
let stepIndex = 0;

/** 当前轮次 DOM：head（标题）+ body（仅 text_delta 累加，不重复贴全量 content） */
let currentRound = null;
/** 本轮是否已收到过 text_delta（无文本的工具轮要显示占位） */
let roundHasText = false;

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = "pill" + (cls ? " " + cls : "");
}

function appendEvent(line) {
  eventsEl.textContent += line + "\n";
  eventsEl.scrollTop = eventsEl.scrollHeight;
}

function clearStream() {
  streamEl.replaceChildren();
  currentRound = null;
  roundHasText = false;
}

/**
 * 新开一轮模型输出区块。
 * 标题先标「输出中」，assistant_message 到达后再改成结束摘要。
 */
function beginRound(title) {
  const block = document.createElement("div");
  block.className = "round";

  const head = document.createElement("div");
  head.className = "round-head";
  head.textContent = title;

  const body = document.createElement("div");
  body.className = "round-body";

  block.append(head, body);
  streamEl.append(block);
  streamEl.scrollTop = streamEl.scrollHeight;

  currentRound = { head, body };
  roundHasText = false;
}

/** 在轮次之间插入工具执行摘要（仍不把工具结果全文塞进流式区） */
function appendToolBanner(text) {
  const el = document.createElement("div");
  el.className = "round-tools";
  el.textContent = text;
  streamEl.append(el);
  streamEl.scrollTop = streamEl.scrollHeight;
}

function refreshTraceChrome() {
  stepLabel.textContent = steps.length
    ? `${stepIndex + 1} / ${steps.length}`
    : "0 / 0";
  renderTraceChrome(traceRailEl, traceEl, steps, stepIndex, (i) => {
    stepIndex = i;
    refreshTraceChrome();
  });
}

/**
 * 加载 Trace：卡片回放 + 重建流式轮次与协议时间线
 */
async function loadTrace() {
  const res = await fetch("/api/trace/latest");
  if (!res.ok) throw new Error("no trace");
  const data = await res.json();
  steps = data.steps || [];
  stepIndex = 0;
  refreshTraceChrome();
  // 重建过程视图（与现场运行同构）：轮次、协议时间线、事件流简要
  rebuildStreamFromSteps(streamEl, steps);
  rebuildTimelineFromSteps(timelineEl, steps);
  rebuildEventsFromSteps(eventsEl, steps);
  currentRound = null;
  roundHasText = false;
  return data;
}

prevBtn.onclick = () => {
  if (stepIndex > 0) {
    stepIndex -= 1;
    refreshTraceChrome();
  }
};

nextBtn.onclick = () => {
  if (stepIndex < steps.length - 1) {
    stepIndex += 1;
    refreshTraceChrome();
  }
};

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
};

runBtn.onclick = async () => {
  abortController = new AbortController();
  runBtn.disabled = true;
  stopBtn.disabled = false;
  clearStream();
  clearTimeline(timelineEl);
  eventsEl.textContent = "";
  setStatus("running");

  // 本轮工具名暂存，用于工具横幅一行展示
  let pendingToolNames = [];

  try {
    await runSse("/api/run", {
      body: { prompt: promptEl.value },
      signal: abortController.signal,
      onEvent: ({ event, data }) => {
        // llm_request → 若上一轮刚跑完工具，先画工具横幅，再开新轮
        if (event === "llm_request") {
          if (pendingToolNames.length) {
            appendToolBanner(`执行工具：${[...new Set(pendingToolNames)].join(" · ")}`);
            pendingToolNames = [];
          }
          const label = data.title || "请求模型";
          beginRound(`${label} · 输出中…`);
          appendEvent(`[llm] ${data.summary || label}`);
          return;
        }

        // 增量只写入当前轮 body，不重复贴全量 content
        if (event === "text_delta") {
          if (!currentRound) beginRound("模型输出 · 输出中…");
          const delta = data?.payload?.delta || data?.summary || "";
          currentRound.body.textContent += delta;
          roundHasText = true;
          streamEl.scrollTop = streamEl.scrollHeight;
          return;
        }

        // 协议细节：文本碎片 / 工具碎片 / 汇总 / 解析完成 → 时间线 + 事件流（不省略）
        if (event === "stream_detail") {
          appendTimelineCard(timelineEl, data);
          const kind = data.payload?.kind;
          if (kind === "text_fragment") {
            const p = data.payload;
            appendEvent(
              `[text #${p.seq}] +${JSON.stringify(p.delta)} → ${JSON.stringify(p.accContent)}`,
            );
          } else if (kind === "tool_fragment") {
            appendEvent(`[tool-frag] ${data.summary || data.title}`);
          } else if (kind === "text_summary") {
            appendEvent(`[text-sum] ${data.summary || ""}`);
          } else if (kind === "tool_parse_done") {
            appendEvent(`[tool-parse] ${data.summary || ""}`);
          } else {
            appendEvent(`[stream] ${data.summary || data.title}`);
          }
          return;
        }

        // 一轮结束：更新标题，标明「何时返回 / 是否调工具」；正文已是流式拼好的
        if (event === "assistant_message") {
          const tools = data.payload?.toolCalls || [];
          const toolNames = tools.map((c) => c.name).filter(Boolean);
          const endLabel = tools.length
            ? `已返回 · ${tools.length} 个工具调用（${toolNames.join(", ")}）`
            : "已返回 · 最终文本（无工具调用）";

          if (currentRound) {
            const base = (data.title || "模型响应").replace(/\s*·\s*模型响应$/, "");
            currentRound.head.textContent = `${base} · ${endLabel}`;
            currentRound.head.classList.add(tools.length ? "is-tools" : "is-final");
            if (!roundHasText) {
              currentRound.body.textContent = tools.length
                ? "（本轮无文本，仅发起工具调用）"
                : "（本轮无文本）";
              currentRound.body.classList.add("is-empty");
            }
          }

          appendEvent(
            `[assistant] ${data.summary}` +
              (toolNames.length ? ` → ${toolNames.join(", ")}` : ""),
          );
          return;
        }

        if (event === "tool_start") {
          const name = data.payload?.name || data.title || "tool";
          pendingToolNames.push(name);
          appendEvent(`[tool_start] ${data.title}`);
          return;
        }

        if (event === "tool_end") {
          appendEvent(`[tool_end] ${data.title}`);
          return;
        }

        if (event === "done") {
          if (pendingToolNames.length) {
            appendToolBanner(`执行工具：${[...new Set(pendingToolNames)].join(" · ")}`);
            pendingToolNames = [];
          }
          appendEvent(`[done] stop=${data.stopReason}`);
          if (data.error) setStatus(data.error, "err");
          else setStatus(data.stopReason || "done", "ok");
          return;
        }

        if (event === "error") {
          appendEvent(`[error] ${data.summary}`);
          setStatus("error", "err");
          return;
        }

        if (event === "meta") {
          appendEvent(`[meta] model=${data.model}`);
          return;
        }

        if (event === "run_start" || event === "run_end") {
          appendEvent(`[${event}] ${data.summary || data.title || ""}`);
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
    } else {
      setStatus("aborted", "err");
    }
  } finally {
    runBtn.disabled = false;
    stopBtn.disabled = true;
  }
};
