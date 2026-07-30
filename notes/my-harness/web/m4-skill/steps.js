/**
 * M4 步骤卡：skill 阶段 + llm_request JSON 回溯
 */

export function createStepsView(root, onSelect) {
  let steps = [];

  function clear() {
    steps = [];
    root.replaceChildren();
  }

  function select(id) {
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
    const step = { _uid: uid, event: eventName, ...data };
    steps.push(step);

    const card = document.createElement("button");
    card.type = "button";
    card.className = "step-card";
    card.dataset.id = String(uid);
    if (eventName === "skill_inject") card.classList.add("is-skill");

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
    card.onclick = () => select(uid);
    root.append(card);
    root.scrollTop = root.scrollHeight;

    if (eventName === "skill_inject" || eventName === "llm_request") {
      select(uid);
    }
  }

  return { clear, append, select };
}

/** 点选步骤后填充详情与 JSON */
export function renderStepDetail(els, step) {
  const { detailPill, detailBody, jsonUnified, jsonOpenAI } = els;
  if (!step) {
    detailPill.textContent = "点选步骤";
    detailBody.textContent = "尚未选择步骤";
    jsonUnified.textContent = "—";
    jsonOpenAI.textContent = "—";
    return;
  }

  detailPill.textContent = `#${step._uid} · ${step.event}`;
  const lines = [
    `title: ${step.title || ""}`,
    `summary: ${step.summary || ""}`,
    step.note ? `note: ${step.note}` : null,
  ].filter(Boolean);
  detailBody.textContent = lines.join("\n");

  const p = step.payload || {};

  if (step.event === "llm_request") {
    jsonUnified.textContent = JSON.stringify(
      {
        context: p.context,
        messagesAfter: p.messagesAfter,
        messagesBefore: p.messagesBefore
          ? `(${p.messagesBefore.length} msgs, 见完整 Trace)`
          : undefined,
      },
      null,
      2,
    );
    jsonOpenAI.textContent = JSON.stringify(p.openaiRequest ?? null, null, 2);
    return;
  }

  if (step.event === "skill_inject") {
    jsonUnified.textContent = JSON.stringify(p, null, 2);
    jsonOpenAI.textContent = p.openaiRequest
      ? JSON.stringify(p.openaiRequest, null, 2)
      : "（本阶段无出站；分类请求才会带 openaiRequest）";
    if (p.messages) {
      detailBody.textContent +=
        "\n\n分类 messages 条数: " + (p.messages?.length ?? 0);
    }
    return;
  }

  if (step.event === "assistant_message") {
    jsonUnified.textContent = JSON.stringify(p, null, 2);
    jsonOpenAI.textContent = "（入站；出站见 llm_request）";
    return;
  }

  jsonUnified.textContent = JSON.stringify(p, null, 2);
  jsonOpenAI.textContent = "—";
}

export const AUTO_DOCS = {
  off: {
    title: "off · 不自动",
    rules: [
      "只有手动勾选或 prompt 里 /skill:name 才会注入全文。",
      "可只开「目录摘要」观察元数据层。",
    ],
  },
  match: {
    title: "match · 启发式二次注入",
    rules: [
      "先写目录（若开启）。",
      "若未手动/命令指定：用 prompt 与 description 词重叠打分。",
      "命中后二次注入全文到 system，再跑主 Agent Loop。",
      "不额外消耗模型调用；结果确定、易对照。",
    ],
  },
  model: {
    title: "model · 模型分类后二次注入",
    rules: [
      "先写目录到一次「分类请求」（无 tools）。",
      "模型只回 JSON {\"skills\":[...]}。",
      "Harness 解析后二次注入全文到 system，再跑主任务。",
      "多一次 API。",
    ],
  },
  agent: {
    title: "agent · Pi 风格（推荐对照 Pi）",
    rules: [
      "system 只放 SKILL 目录（name+description）。",
      "额外注册工具 load_skill（对照 Pi 用 read 读 SKILL.md）。",
      "模型自己决定何时 load_skill；全文以纯 Markdown 经 tool 消息回写（对齐 Pi read，无 JSON 壳）。",
      "Harness 不预注入全文。步骤里应看到 tool_start/tool_end · load_skill。",
    ],
  },
};

export function renderAutoHelp(el, mode) {
  const doc = AUTO_DOCS[mode] || AUTO_DOCS.off;
  el.innerHTML = `<h3>${doc.title}</h3><ol>${doc.rules
    .map((r) => `<li>${r}</li>`)
    .join("")}</ol>`;
}
