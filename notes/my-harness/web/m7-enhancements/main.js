/**
 * M7 演示页：确认门闩 / reasoning / partial args / Trace 步进
 */
import { runSse } from "../shared/shared.js";
import {
  bindTracePlayerControls,
  createTracePlayer,
} from "../shared/trace-player.js";

const confirmPill = document.getElementById("confirmPill");
const confirmBox = document.getElementById("confirmBox");
const requireConfirmEl = document.getElementById("requireConfirm");
const btnAllow = document.getElementById("btnAllow");
const btnDeny = document.getElementById("btnDeny");
const reasoningEl = document.getElementById("reasoning");
const answerEl = document.getElementById("answer");
const partialBox = document.getElementById("partialBox");
const partialPill = document.getElementById("partialPill");
const eventsEl = document.getElementById("events");
const statusEl = document.getElementById("status");
const promptEl = document.getElementById("prompt");
const runBtn = document.getElementById("run");
const stopBtn = document.getElementById("stop");

const PROMPTS = {
  wipe: "请调用 wipe_demo，confirmToken 用「m7-demo」，然后用中文说明是否执行成功。",
  weather: "查深圳天气，再算 12 加 30，最后中文总结。",
};

let abortController = null;
let pendingConfirm = null; // { runId, toolCallId, name, arguments }
let currentRunId = null;

const playerEls = {
  stepEl: document.getElementById("playerStep"),
  pillEl: document.getElementById("playerPill"),
  flowEl: document.getElementById("flow"),
  btnPrev: document.getElementById("btnPrev"),
  btnNext: document.getElementById("btnNext"),
  btnPlay: document.getElementById("btnPlay"),
};
const player = createTracePlayer(playerEls);
bindTracePlayerControls(player, playerEls);

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = "pill" + (cls ? " " + cls : "");
}

function appendEvent(line) {
  eventsEl.textContent += line + "\n";
  eventsEl.scrollTop = eventsEl.scrollHeight;
}

function setPending(p) {
  pendingConfirm = p;
  const has = Boolean(p);
  btnAllow.disabled = !has;
  btnDeny.disabled = !has;
  confirmPill.textContent = has ? "waiting" : "idle";
  confirmPill.className = "pill" + (has ? " warn" : "");
  confirmBox.textContent = has
    ? JSON.stringify(p, null, 2)
    : "（尚无待确认调用）";
}

async function sendDecision(decision) {
  if (!pendingConfirm) return;
  const body = {
    runId: pendingConfirm.runId,
    toolCallId: pendingConfirm.toolCallId,
    decision,
  };
  const res = await fetch("/api/run/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  appendEvent("[confirm] " + decision + " → " + JSON.stringify(data));
  if (data.ok) {
    confirmPill.textContent = decision;
    confirmPill.className = "pill " + (decision === "allow" ? "ok" : "err");
    btnAllow.disabled = true;
    btnDeny.disabled = true;
  } else {
    setStatus("confirm 失败: " + (data.error || res.status), "err");
  }
}

btnAllow.onclick = () => sendDecision("allow");
btnDeny.onclick = () => sendDecision("deny");

document.querySelectorAll("[data-prompt]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const k = btn.getAttribute("data-prompt");
    if (k && PROMPTS[k]) promptEl.value = PROMPTS[k];
  });
});

function handleRunEvent(event, data) {
  if (event === "meta") {
    currentRunId = data.runId || null;
    appendEvent(
      "[meta] runId=" +
        currentRunId +
        " requireConfirm=" +
        data.requireConfirm +
        " highRisk=" +
        JSON.stringify(data.highRiskTools || []),
    );
    return;
  }

  if (data && data.type) {
    appendEvent(
      "[" +
        data.type +
        "] " +
        (data.title || "") +
        " · " +
        (data.summary || "").slice(0, 120),
    );
  } else {
    appendEvent("[" + event + "] " + JSON.stringify(data).slice(0, 160));
  }

  if (event === "reasoning_delta" || data?.type === "reasoning_delta") {
    const d = data?.payload?.delta ?? data?.summary ?? "";
    reasoningEl.textContent += d;
    return;
  }

  if (event === "text_delta" || data?.type === "text_delta") {
    const d = data?.payload?.delta ?? data?.summary ?? "";
    answerEl.textContent += d;
    return;
  }

  if (event === "stream_detail" || data?.type === "stream_detail") {
    const p = data?.payload;
    if (p?.kind === "tool_fragment") {
      partialPill.textContent = p.partialNote || "frag";
      partialBox.textContent = JSON.stringify(
        {
          index: p.index,
          accName: p.accName,
          accArguments: p.accArguments,
          partialArgs: p.partialArgs,
          partialNote: p.partialNote,
          note: "仅预览；执行仍在 tool_parse_done 之后",
        },
        null,
        2,
      );
    }
    return;
  }

  if (event === "tool_confirm_pending" || data?.type === "tool_confirm_pending") {
    const p = data?.payload || {};
    setPending({
      runId: p.runId || currentRunId,
      toolCallId: p.toolCallId,
      name: p.name,
      arguments: p.arguments,
    });
    setStatus("waiting confirm · " + p.name, "warn");
    return;
  }

  if (event === "tool_confirm_result" || data?.type === "tool_confirm_result") {
    const p = data?.payload || {};
    appendEvent("[decision] " + p.decision + " · " + p.name);
    if (pendingConfirm && pendingConfirm.toolCallId === p.toolCallId) {
      pendingConfirm = null;
      btnAllow.disabled = true;
      btnDeny.disabled = true;
    }
    return;
  }

  if (event === "done") {
    setStatus(
      "done · " + (data?.stopReason || data?.decision || "ok"),
      data?.error ? "err" : "ok",
    );
    setPending(null);
  }
}

async function startRun(body) {
  eventsEl.textContent = "";
  reasoningEl.textContent = "";
  answerEl.textContent = "";
  partialBox.textContent = "（等待碎片…）";
  setPending(null);
  setStatus("running…");
  runBtn.disabled = true;
  stopBtn.disabled = false;
  document.getElementById("btnLocalConfirm").disabled = true;
  abortController = new AbortController();

  try {
    await runSse("/api/run", {
      body,
      signal: abortController.signal,
      onEvent: ({ event, data }) => handleRunEvent(event, data),
    });
  } catch (err) {
    if (err?.name === "AbortError") setStatus("aborted", "warn");
    else setStatus(String(err?.message || err), "err");
  } finally {
    runBtn.disabled = false;
    stopBtn.disabled = true;
    document.getElementById("btnLocalConfirm").disabled = false;
    abortController = null;
  }
}

document.getElementById("btnLocalConfirm").onclick = () =>
  startRun({
    localGuard: "confirm_wipe",
    requireConfirm: true,
  });

runBtn.onclick = () =>
  startRun({
    prompt: promptEl.value,
    requireConfirm: requireConfirmEl.checked,
    maxSteps: 6,
    systemPrompt:
      "你是助手。若用户要求 wipe_demo，必须调用工具 wipe_demo，不要假装已执行。" +
      "需要天气或加法时也必须调用工具。",
  });

stopBtn.onclick = () => abortController?.abort();

document.getElementById("btnLoadTrace").onclick = async () => {
  const res = await fetch("/api/trace/latest");
  if (!res.ok) {
    player.setError("加载失败 HTTP " + res.status);
    return;
  }
  const data = await res.json();
  player.load(data);
};
