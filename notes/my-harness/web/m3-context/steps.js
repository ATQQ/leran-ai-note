/**
 * M3 步骤卡 + 裁剪细则 / JSON 对照渲染
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

    if (eventName === "llm_request") select(uid);
  }

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

function renderMsgRows(rows, kind) {
  const wrap = document.createElement("div");
  wrap.className = "trim-rows";
  if (!rows?.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = kind === "kept" ? "（无保留）" : "（无丢弃）";
    wrap.append(empty);
    return wrap;
  }
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = `trim-row ${kind}`;
    row.innerHTML = `
      <span>#${r.index}</span>
      <span class="role">${r.role}</span>
      <span>${r.chars}字</span>
      <span>${escapeHtml(r.preview)}</span>
      <span class="reason">${escapeHtml(r.reason || "")}</span>
    `;
    wrap.append(row);
  }
  return wrap;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 渲染策略规则 / 执行步骤 / 保留丢弃清单 */
export function renderTrimDetail(container, ctx) {
  container.replaceChildren();
  if (!ctx?.detail) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = ctx
      ? "本次 Trace 无 detail 字段（可能是旧 Trace）；请重新运行一次。"
      : "运行并点击 llm_request 后显示细则。";
    container.append(p);
    return;
  }

  const d = ctx.detail;

  const rulesBlock = document.createElement("div");
  rulesBlock.className = "trim-block";
  rulesBlock.innerHTML = `<h4>策略规则（${escapeHtml(ctx.strategy)}）</h4>`;
  const ol = document.createElement("ol");
  for (const line of d.rules || []) {
    const li = document.createElement("li");
    li.textContent = line;
    ol.append(li);
  }
  rulesBlock.append(ol);
  container.append(rulesBlock);

  const stepsBlock = document.createElement("div");
  stepsBlock.className = "trim-block";
  stepsBlock.innerHTML = "<h4>本轮执行步骤</h4>";
  const sol = document.createElement("ol");
  for (const line of d.steps || []) {
    const li = document.createElement("li");
    li.textContent = line;
    sol.append(li);
  }
  stepsBlock.append(sol);
  container.append(stepsBlock);

  const keptBlock = document.createElement("div");
  keptBlock.className = "trim-block";
  keptBlock.innerHTML = `<h4>保留 ${d.kept?.length ?? 0} 条</h4>`;
  keptBlock.append(renderMsgRows(d.kept, "kept"));
  container.append(keptBlock);

  const dropBlock = document.createElement("div");
  dropBlock.className = "trim-block";
  dropBlock.innerHTML = `<h4>丢弃 ${d.dropped?.length ?? 0} 条</h4>`;
  dropBlock.append(renderMsgRows(d.dropped, "dropped"));
  container.append(dropBlock);
}

/** 页面上方：随下拉切换的策略说明（不依赖运行） */
export const STRATEGY_DOCS = {
  identity: {
    title: "identity · 不裁剪",
    rules: [
      "完整 messages 原样发给 Adapter。",
      "用来当对照组：同一历史换其它策略，看条数/字符如何变。",
    ],
    params: "无额外参数",
  },
  recent_n: {
    title: "recent_n · 最近 N 条",
    rules: [
      "前缀连续 system 全部保留。",
      "其余只留最近 recentN 条（从尾部数）。",
      "若裁切点落在 tool 上，向前回补 assistant.toolCalls，避免配对断裂。",
      "内存完整轨迹仍在；这里裁的是「发给模型的视图」。",
    ],
    params: (recentN) => `当前 recentN=${recentN} → 非 system 历史最多留 ${recentN} 条`,
  },
  char_budget: {
    title: "char_budget · 字符预算",
    rules: [
      "字符=粗估（content + toolCalls JSON 等），不是真实 token。",
      "system 先占预算；若已 ≥ maxChars，只发 system。",
      "再从历史尾部向前逐条塞，直到再加会超 maxChars。",
      "一条都塞不下时强制留最后 1 条（可略超）。",
      "同样做 tool 孤儿回补；配对正确优先于严格卡预算。",
    ],
    params: (maxChars) =>
      `当前 maxChars=${maxChars} → 发给模型的粗估字符上限（含 system）`,
  },
  summarize: {
    title: "summarize · 本地摘要",
    rules: [
      "与 recent_n 对比：旧消息不是直接丢掉，而是压成 1 条【历史摘要】。",
      "前缀 system 保留；最近 recentN 条原文保留（含 tool 孤儿回补）。",
      "较早段用本地抽取（角色 + 短预览列表），不调模型、可离线演示。",
      "摘要以 user 消息插入 system 与最近窗口之间。",
      "Harness 内存全量轨迹不变；摘要只影响发给模型的视图。",
    ],
    params: (recentN) =>
      `当前 recentN=${recentN} → 最近 ${recentN} 条原文，更早的变摘要`,
  },
  summarize_llm: {
    title: "summarize_llm · 模型摘要",
    rules: [
      "结构同 summarize：摘要 1 条 + 最近 recentN 原文。",
      "摘要正文另调一次短补全（非流式）；失败回退本地抽取。",
      "适合体会「lossy 压缩」：模型续聊仍知道旧目标，但不保证逐字还原。",
      "成本：每轮发模型前可能多 1 次摘要请求（本演示未做缓存）。",
    ],
    params: (recentN) =>
      `当前 recentN=${recentN} → LLM 压缩较早历史，最近 ${recentN} 条不动`,
  },
};

export function renderStrategyHelp(el, strategy, { recentN, maxChars }) {
  const doc = STRATEGY_DOCS[strategy] || STRATEGY_DOCS.identity;
  const paramText =
    typeof doc.params === "function"
      ? doc.params(
          strategy === "char_budget" ? maxChars : recentN,
        )
      : doc.params;

  el.replaceChildren();
  const h = document.createElement("h3");
  h.textContent = doc.title;
  const ol = document.createElement("ol");
  for (const r of doc.rules) {
    const li = document.createElement("li");
    li.textContent = r;
    ol.append(li);
  }
  const p = document.createElement("div");
  p.className = "param-hint";
  p.textContent = paramText;
  el.append(h, ol, p);
}

/** 把选中的 llm_request 填进细则 + JSON 三栏 */
export function renderJsonCompare(els, step) {
  const { jsonBefore, jsonAfter, jsonOpenAI, jsonRound, ctxStats, trimDetail } = els;
  if (!step || step.event !== "llm_request") {
    jsonRound.textContent = step ? `#${step._uid} ${step.event}` : "—";
    jsonBefore.textContent = "（请点击「llm_request」步骤查看裁剪前后）";
    jsonAfter.textContent = "—";
    jsonOpenAI.textContent = step?.payload
      ? JSON.stringify(step.payload, null, 2)
      : "—";
    ctxStats.textContent = step?.summary || "尚未选择 llm_request 步骤";
    if (trimDetail) renderTrimDetail(trimDetail, null);
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
  ]
    .filter(Boolean)
    .join("\n");

  if (trimDetail) renderTrimDetail(trimDetail, ctx);
}
