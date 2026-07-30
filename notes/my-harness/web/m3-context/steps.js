/**
 * M3 步骤卡：把 RunEvent 渲染成可点击的学习步骤
 * 点击 llm_request 步骤 → 回调展示 JSON 对照
 */

/**
 * @param {HTMLElement} root
 * @param {(step: object) => void} onSelect
 */
export function createStepsView(root, onSelect) {
  /** @type {object[]} */
  let steps = [];
  let activeId = null;

  function clear() {
    steps = [];
    activeId = null;
    root.replaceChildren();
  }

  function select(id) {
    activeId = id;
    root.querySelectorAll(".step-card").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.id === String(id));
    });
    const step = steps.find((s) => s._uid === id);
    if (step) onSelect?.(step);
  }

  function append(eventName, data) {
    // 过滤掉刷屏的 text_delta / 细碎 stream_detail（需要时再在事件流看）
    if (eventName === "text_delta") return;
    if (eventName === "stream_detail") {
      const kind = data.payload?.kind;
      if (kind !== "tool_parse_done" && kind !== "text_summary") return;
    }

    const uid = steps.length + 1;
    const step = {
      _uid: uid,
      event: eventName,
      ...data,
    };
    steps.push(step);

    const card = document.createElement("button");
    card.type = "button";
    card.className = "step-card";
    card.dataset.id = String(uid);

    const trimmed =
      eventName === "llm_request" && (data.payload?.context?.droppedCount ?? 0) > 0;
    if (trimmed) card.classList.add("is-trim");

    const head = document.createElement("div");
    head.className = "step-head";
    head.innerHTML = `<span>#${uid} · ${eventName}</span><span>${data.phase || ""}</span>`;

    const title = document.createElement("div");
    title.className = "step-title";
    title.textContent = data.title || eventName;

    const summary = document.createElement("div");
    summary.className = "step-summary";
    summary.textContent = data.summary || "";

    card.append(head, title, summary);
    if (data.note) {
      const note = document.createElement("div");
      note.className = "step-note";
      note.textContent = data.note;
      card.append(note);
    }

    card.onclick = () => select(uid);
    root.append(card);
    root.scrollTop = root.scrollHeight;

    // llm_request 自动选中，立刻展示 JSON
    if (eventName === "llm_request") select(uid);
  }

  /** 从 Trace steps 重建（加载 Trace 时） */
  function fromTraceSteps(traceSteps) {
    clear();
    for (const s of traceSteps || []) {
      append(s.phase === "request_model" ? "llm_request" : s.phase || "step", {
        type: s.phase,
        phase: s.phase,
        title: s.title,
        summary: s.summary,
        note: s.note,
        payload: s.payload,
        actor: s.actor,
        direction: s.direction,
      });
    }
  }

  return { clear, append, fromTraceSteps, select };
}

/** 把选中的 llm_request 填进 JSON 三栏 */
export function renderJsonCompare(els, step) {
  const { jsonBefore, jsonAfter, jsonOpenAI, jsonRound, ctxStats } = els;
  if (!step || step.event !== "llm_request") {
    // 非请求步骤：尽量展示自身 payload
    jsonRound.textContent = step ? `#${step._uid} ${step.event}` : "—";
    jsonBefore.textContent = "（请点击「llm_request」步骤查看裁剪前后）";
    jsonAfter.textContent = "—";
    jsonOpenAI.textContent = step?.payload
      ? JSON.stringify(step.payload, null, 2)
      : "—";
    ctxStats.textContent = step?.summary || "尚未选择 llm_request 步骤";
    return;
  }

  const p = step.payload || {};
  const ctx = p.context || {};
  jsonRound.textContent = `#${step._uid} · ${ctx.strategy || "?"} · ${ctx.beforeCount}→${ctx.afterCount}`;
  jsonRound.className = "pill" + (ctx.droppedCount > 0 ? " trim" : " ok");

  jsonBefore.textContent = JSON.stringify(p.messagesBefore ?? null, null, 2);
  jsonAfter.textContent = JSON.stringify(p.messagesAfter ?? null, null, 2);
  jsonOpenAI.textContent = JSON.stringify(p.openaiRequest ?? null, null, 2);

  ctxStats.textContent = [
    `策略: ${ctx.strategy}`,
    `条数: ${ctx.beforeCount} → ${ctx.afterCount}（丢弃 ${ctx.droppedCount ?? 0}）`,
    `字符(估): ${ctx.beforeChars} → ${ctx.afterChars}`,
    ctx.params ? `参数: ${JSON.stringify(ctx.params)}` : null,
    ctx.note ? `说明: ${ctx.note}` : null,
    "提示: 右侧/下方 OpenAI JSON 即 Adapter 出站体（无 API Key）",
  ]
    .filter(Boolean)
    .join("\n");
}
