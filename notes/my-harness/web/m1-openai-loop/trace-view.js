/**
 * Trace 卡片回放 + 从 steps 重建流式轮次视图
 *
 * 加载 Trace 后应看到与现场运行同构的过程，而不是只有一个大 JSON。
 */

/**
 * @param {HTMLElement} railEl 步骤目录
 * @param {HTMLElement} mainEl 当前步详情
 * @param {Array} steps
 * @param {number} index
 * @param {(i: number) => void} onSelect
 */
export function renderTraceChrome(railEl, mainEl, steps, index, onSelect) {
  railEl.replaceChildren();
  if (!steps.length) {
    mainEl.replaceChildren();
    mainEl.textContent = "无步骤";
    return;
  }

  steps.forEach((step, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "trace-rail-item" + (i === index ? " active" : "");
    btn.textContent = `${step.id ?? i + 1}. ${step.title || step.phase || "step"}`;
    btn.onclick = () => onSelect(i);
    railEl.append(btn);
  });

  renderTraceStepCard(mainEl, steps[index]);
}

/**
 * 结构化卡片：摘要 + 关键字段 + 可折叠原始 JSON
 * @param {HTMLElement} mainEl
 * @param {object} step
 */
export function renderTraceStepCard(mainEl, step) {
  mainEl.replaceChildren();
  if (!step) {
    mainEl.textContent = "无步骤";
    return;
  }

  const card = document.createElement("div");
  card.className = "trace-card";

  const title = document.createElement("h3");
  title.textContent = step.title || "(无标题)";
  card.append(title);

  const meta = document.createElement("div");
  meta.className = "trace-meta";
  meta.textContent = [
    step.phase && `phase=${step.phase}`,
    step.actor && `actor=${step.actor}`,
    step.direction && `dir=${step.direction}`,
    step.at && `at=${step.at}`,
  ]
    .filter(Boolean)
    .join(" · ");
  card.append(meta);

  const summary = document.createElement("p");
  summary.className = "trace-summary";
  summary.textContent = step.summary || "";
  card.append(summary);

  if (step.note) {
    const note = document.createElement("p");
    note.className = "trace-note";
    note.textContent = step.note;
    card.append(note);
  }

  // stream_detail / 常见 payload 的关键字段表
  const payload = step.payload;
  if (payload && typeof payload === "object") {
    const kind = payload.kind;
    if (kind === "text_fragment") {
      const table = document.createElement("div");
      table.className = "tl-grid";
      for (const [k, v] of [
        ["seq", payload.seq],
        ["delta", payload.delta],
        ["accContent", payload.accContent],
      ]) {
        if (v === undefined || v === null) continue;
        const key = document.createElement("span");
        key.className = "tl-k";
        key.textContent = k;
        const val = document.createElement("code");
        val.className = "tl-v";
        val.textContent = String(v);
        table.append(key, val);
      }
      card.append(table);
    } else if (kind === "tool_fragment" || kind === "text_summary") {
      const table = document.createElement("div");
      table.className = "tl-grid";
      const entries =
        kind === "tool_fragment"
          ? [
              ["index", payload.index],
              ["id", payload.id],
              ["accName", payload.accName],
              ["accArguments", payload.accArguments],
              ["nameDelta", payload.nameDelta],
              ["argumentsDelta", payload.argumentsDelta],
            ]
          : [
              ["deltaCount", payload.deltaCount],
              ["contentLength", payload.contentLength],
            ];
      for (const [k, v] of entries) {
        if (v === undefined || v === null) continue;
        const key = document.createElement("span");
        key.className = "tl-k";
        key.textContent = k;
        const val = document.createElement("code");
        val.className = "tl-v";
        val.textContent = String(v);
        table.append(key, val);
      }
      card.append(table);
      if (kind === "text_summary" && payload.content) {
        const pre = document.createElement("pre");
        pre.className = "tl-json";
        pre.textContent = payload.content;
        card.append(pre);
      }
    } else if (kind === "tool_parse_done" && payload.toolCalls) {
      const pre = document.createElement("pre");
      pre.className = "tl-json";
      pre.textContent = JSON.stringify(payload.toolCalls, null, 2);
      card.append(pre);
    } else if (payload.toolCalls || payload.content !== undefined) {
      // assistant_message 等
      if (payload.content != null) {
        const p = document.createElement("pre");
        p.className = "tl-json";
        p.textContent = String(payload.content);
        card.append(p);
      }
      if (payload.toolCalls?.length) {
        const pre = document.createElement("pre");
        pre.className = "tl-json";
        pre.textContent = JSON.stringify(payload.toolCalls, null, 2);
        card.append(pre);
      }
    }
  }

  const details = document.createElement("details");
  const summaryEl = document.createElement("summary");
  summaryEl.textContent = "原始 JSON";
  const pre = document.createElement("pre");
  pre.className = "tl-json";
  pre.textContent = JSON.stringify(step, null, 2);
  details.append(summaryEl, pre);
  card.append(details);

  mainEl.append(card);
}

/**
 * 从 Trace steps 重建「流式文本」轮次块（与现场运行同构的大致过程）
 * @param {HTMLElement} streamEl
 * @param {Array} steps
 */
export function rebuildStreamFromSteps(streamEl, steps) {
  streamEl.replaceChildren();
  let current = null;
  let pendingTools = [];

  const beginRound = (title) => {
    const block = document.createElement("div");
    block.className = "round";
    const head = document.createElement("div");
    head.className = "round-head";
    head.textContent = title;
    const body = document.createElement("div");
    body.className = "round-body";
    block.append(head, body);
    streamEl.append(block);
    current = { head, body, hasText: false };
  };

  const toolBanner = (text) => {
    const el = document.createElement("div");
    el.className = "round-tools";
    el.textContent = text;
    streamEl.append(el);
  };

  for (const step of steps) {
    if (step.phase === "request_model") {
      if (pendingTools.length) {
        toolBanner(`执行工具：${[...new Set(pendingTools)].join(" · ")}`);
        pendingTools = [];
      }
      beginRound(`${step.title || "请求模型"} ·（回放）`);
      continue;
    }

    if (step.phase === "model_response") {
      const tools = step.payload?.toolCalls || [];
      const toolNames = tools.map((c) => c.name).filter(Boolean);
      const endLabel = tools.length
        ? `已返回 · ${tools.length} 个工具调用（${toolNames.join(", ")}）`
        : "已返回 · 最终文本（无工具调用）";
      if (current) {
        const base = (step.title || "模型响应").replace(/\s*·\s*模型响应$/, "");
        current.head.textContent = `${base} · ${endLabel}`;
        current.head.classList.add(tools.length ? "is-tools" : "is-final");
        const content = step.payload?.content;
        if (content) {
          current.body.textContent = content;
          current.hasText = true;
        } else if (!current.hasText) {
          current.body.textContent = tools.length
            ? "（本轮无文本，仅发起工具调用）"
            : "（本轮无文本）";
          current.body.classList.add("is-empty");
        }
      }
      continue;
    }

    if (step.phase === "execute_tool") {
      const name = step.payload?.name;
      if (name) pendingTools.push(name);
      continue;
    }

    // 文本汇总：优先用完整 content 填回轮次正文
    if (step.payload?.kind === "text_summary" && current) {
      const full = step.payload.content;
      if (full && !current.hasText) {
        current.body.textContent = full;
        current.hasText = true;
        current.body.classList.remove("is-empty");
      } else if (!current.hasText) {
        const n = step.payload.deltaCount || 0;
        if (n > 0) {
          current.body.textContent = `（回放：${n} 帧 text_delta，总长 ${step.payload.contentLength}）`;
          current.body.classList.add("is-empty");
        }
      }
    }
  }

  if (pendingTools.length) {
    toolBanner(`执行工具：${[...new Set(pendingTools)].join(" · ")}`);
  }
}

/**
 * 从 Trace steps 重建「事件流（简要）」文本，便于加载后回顾
 * @param {HTMLElement} eventsEl
 * @param {Array} steps
 */
export function rebuildEventsFromSteps(eventsEl, steps) {
  const lines = [];
  for (const step of steps) {
    const phase = step.phase || "";
    if (phase === "init") {
      lines.push(`[run_start] ${step.summary || step.title || ""}`);
      continue;
    }
    if (phase === "request_model") {
      lines.push(`[llm] ${step.summary || step.title || ""}`);
      continue;
    }
    if (phase === "stream_parse") {
      const kind = step.payload?.kind;
      if (kind === "text_fragment") {
        const p = step.payload;
        lines.push(
          `[text #${p.seq}] +${JSON.stringify(p.delta)} → ${JSON.stringify(p.accContent)}`,
        );
      } else if (kind === "tool_fragment") {
        lines.push(`[tool-frag] ${step.summary || step.title || ""}`);
      } else if (kind === "text_summary") {
        lines.push(`[text-sum] ${step.summary || ""}`);
      } else if (kind === "tool_parse_done") {
        lines.push(`[tool-parse] ${step.summary || ""}`);
      } else {
        lines.push(`[stream] ${step.summary || step.title || ""}`);
      }
      continue;
    }
    if (phase === "model_response") {
      const tools = step.payload?.toolCalls || [];
      const names = tools.map((c) => c.name).filter(Boolean);
      lines.push(
        `[assistant] ${step.summary || ""}` +
          (names.length ? ` → ${names.join(", ")}` : ""),
      );
      continue;
    }
    if (phase === "execute_tool") {
      lines.push(`[tool_start] ${step.title || ""}`);
      continue;
    }
    if (phase === "append_tool_result") {
      lines.push(`[tool_end] ${step.title || ""}`);
      continue;
    }
    if (phase === "final_answer") {
      lines.push(`[run_end] ${step.summary || step.title || ""}`);
      continue;
    }
    if (phase === "error") {
      lines.push(`[error] ${step.summary || ""}`);
      continue;
    }
    lines.push(`[${phase || "step"}] ${step.title || step.summary || ""}`);
  }
  eventsEl.textContent = lines.join("\n") + (lines.length ? "\n" : "");
  eventsEl.scrollTop = eventsEl.scrollHeight;
}
