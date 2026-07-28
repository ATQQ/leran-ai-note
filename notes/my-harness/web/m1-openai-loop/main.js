import { runSse } from "../shared/shared.js";

const promptEl = document.getElementById("prompt");
const streamEl = document.getElementById("stream");
const eventsEl = document.getElementById("events");
const statusEl = document.getElementById("status");
const traceEl = document.getElementById("trace");
const stepLabel = document.getElementById("stepLabel");
const runBtn = document.getElementById("run");
const stopBtn = document.getElementById("stop");
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");
const reloadTraceBtn = document.getElementById("reloadTrace");

let abortController = null;
let steps = [];
let stepIndex = 0;

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = "pill" + (cls ? " " + cls : "");
}

function appendEvent(line) {
  eventsEl.textContent += line + "\n";
  eventsEl.scrollTop = eventsEl.scrollHeight;
}

function renderStep() {
  if (!steps.length) {
    stepLabel.textContent = "0 / 0";
    traceEl.textContent = "无步骤";
    return;
  }
  const s = steps[stepIndex];
  stepLabel.textContent = `${stepIndex + 1} / ${steps.length}`;
  traceEl.textContent = JSON.stringify(s, null, 2);
}

prevBtn.onclick = () => {
  if (stepIndex > 0) {
    stepIndex -= 1;
    renderStep();
  }
};

nextBtn.onclick = () => {
  if (stepIndex < steps.length - 1) {
    stepIndex += 1;
    renderStep();
  }
};

async function loadTrace() {
  const res = await fetch("/api/trace/latest");
  if (!res.ok) throw new Error("no trace");
  const data = await res.json();
  steps = data.steps || [];
  stepIndex = 0;
  renderStep();
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
};

runBtn.onclick = async () => {
  abortController = new AbortController();
  runBtn.disabled = true;
  stopBtn.disabled = false;
  streamEl.textContent = "";
  eventsEl.textContent = "";
  setStatus("running");

  try {
    await runSse("/api/run", {
      body: { prompt: promptEl.value },
      signal: abortController.signal,
      onEvent: ({ event, data }) => {
        if (event === "text_delta") {
          streamEl.textContent += data?.payload?.delta || data?.summary || "";
        } else if (event === "assistant_message") {
          appendEvent(
            `[assistant] ${data.summary}` +
              (data.payload?.toolCalls?.length
                ? ` → ${data.payload.toolCalls.map((c) => c.name).join(", ")}`
                : ""),
          );
          if (data.payload?.content) {
            streamEl.textContent +=
              (streamEl.textContent ? "\n---\n" : "") + data.payload.content;
          }
        } else if (event === "tool_start" || event === "tool_end") {
          appendEvent(`[${event}] ${data.title}`);
        } else if (event === "done") {
          appendEvent(`[done] stop=${data.stopReason}`);
          if (data.finalText) {
            streamEl.textContent =
              (streamEl.textContent ? streamEl.textContent + "\n\n" : "") +
              "最终：" +
              data.finalText;
          }
          if (data.error) setStatus(data.error, "err");
          else setStatus(data.stopReason || "done", "ok");
        } else if (event === "error") {
          appendEvent(`[error] ${data.summary}`);
          setStatus("error", "err");
        } else if (event === "meta") {
          appendEvent(`[meta] model=${data.model}`);
        } else {
          appendEvent(`[${event}] ${data.title || data.summary || ""}`);
        }
      },
    });
    try {
      await loadTrace();
    } catch {
      /* ignore */
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
