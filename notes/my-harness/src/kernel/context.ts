/**
 * Context 组装与裁剪（M3）
 *
 * 对应 Pi：transformContext → 再交给 Adapter convertToLlm。
 * 本文件只产出 UnifiedMessage[]，不出现厂商协议字段。
 *
 * 基线策略（无 tokenizer）：
 * - identity：原样发送（M1/M2 默认）
 * - recent_n：保留全部 system + 最近 N 条非 system（并回补 tool 孤儿）
 * - char_budget：保留 system + 从尾部按字符预算塞入（同样回补 tool 孤儿）
 *
 * 原则：裁剪的是「发给模型的视图」；loop 内存里的完整 messages 轨迹仍保留（审计用）。
 */
import type { UnifiedMessage } from "../types.ts";

/** 单条消息在裁剪审计中的一行 */
export type AssembleMessageRow = {
  /** 在裁剪前完整数组中的下标 */
  index: number;
  role: string;
  chars: number;
  preview: string;
  /** 为何保留 / 丢弃 */
  reason: string;
};

/** 策略细则 + 本轮执行过程（供 M3 页展示） */
export type AssembleDetail = {
  /** 该策略的固定规则（与参数无关的说明） */
  rules: string[];
  /** 本轮实际执行步骤（含数字） */
  steps: string[];
  kept: AssembleMessageRow[];
  dropped: AssembleMessageRow[];
};

/** 单次组装的审计元信息（写入 llm_request Trace） */
export type AssembleMeta = {
  strategy: string;
  beforeCount: number;
  afterCount: number;
  beforeChars: number;
  afterChars: number;
  droppedCount: number;
  /** 策略参数快照，便于页面对照 */
  params?: Record<string, unknown>;
  note?: string;
  /** 裁剪细则：规则、步骤、保留/丢弃清单 */
  detail?: AssembleDetail;
};

export type AssembleResult = {
  messages: UnifiedMessage[];
  meta: AssembleMeta;
};

export type AssembleContextFn = (messages: UnifiedMessage[]) => AssembleResult;

/** 估算消息占用字符（粗略，学习向；非真实 token） */
export function estimateChars(messages: UnifiedMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (m.content) n += m.content.length;
    if (m.reasoning) n += m.reasoning.length;
    if (m.name) n += m.name.length;
    if (m.toolCallId) n += m.toolCallId.length;
    if (m.toolCalls) {
      for (const c of m.toolCalls) {
        n += c.name.length + c.id.length + JSON.stringify(c.arguments ?? {}).length;
      }
    }
  }
  return n;
}

/** 单条消息的摘要（给 UI / Trace，不含实现源码） */
export function summarizeMessage(m: UnifiedMessage): {
  role: string;
  chars: number;
  preview: string;
  toolCalls?: string[];
  toolCallId?: string;
} {
  const raw = m.content ?? "";
  const preview =
    raw.length > 80 ? `${raw.slice(0, 80)}…` : raw || (m.toolCalls?.length ? "(tool calls)" : "(empty)");
  return {
    role: m.role,
    chars: estimateChars([m]),
    preview,
    toolCalls: m.toolCalls?.map((c) => c.name),
    toolCallId: m.toolCallId,
  };
}

/**
 * 若切片以 tool 消息开头，向前回补到对应的 assistant（带 toolCalls），
 * 避免 OpenAI 要求的 tool_call_id 配对被裁断。
 */
function repairToolOrphans(
  full: UnifiedMessage[],
  startIndex: number,
  endIndex: number,
): { start: number; note?: string } {
  let start = startIndex;
  let note: string | undefined;
  while (start > 0 && start < endIndex && full[start]?.role === "tool") {
    // 向前找到最近一条带 toolCalls 的 assistant
    let found = -1;
    for (let i = start - 1; i >= 0; i--) {
      if (full[i].role === "assistant" && (full[i].toolCalls?.length ?? 0) > 0) {
        found = i;
        break;
      }
    }
    if (found < 0) break;
    start = found;
    note = "已回补 tool 消息前的 assistant，避免 tool_call 配对断裂";
  }
  return { start, note };
}

function splitSystemAndRest(messages: UnifiedMessage[]): {
  system: UnifiedMessage[];
  rest: UnifiedMessage[];
} {
  const system: UnifiedMessage[] = [];
  const rest: UnifiedMessage[] = [];
  let seenNonSystem = false;
  for (const m of messages) {
    // 仅保留前缀连续的 system（中间插入的 system 当作普通历史）
    if (!seenNonSystem && m.role === "system") {
      system.push(m);
    } else {
      seenNonSystem = true;
      rest.push(m);
    }
  }
  return { system, rest };
}

function rowOf(m: UnifiedMessage, index: number, reason: string): AssembleMessageRow {
  const s = summarizeMessage(m);
  return {
    index,
    role: s.role,
    chars: s.chars,
    preview: s.preview,
    reason,
  };
}

function diffKeptDropped(
  before: UnifiedMessage[],
  after: UnifiedMessage[],
  keepReason: (index: number, m: UnifiedMessage) => string,
  dropReason: (index: number, m: UnifiedMessage) => string,
): { kept: AssembleMessageRow[]; dropped: AssembleMessageRow[] } {
  // after 中的对象应是 before 的引用子集；用 indexOf 对齐下标
  const keptIdx = new Set<number>();
  const kept: AssembleMessageRow[] = [];
  for (const m of after) {
    const idx = before.indexOf(m);
    if (idx >= 0) {
      keptIdx.add(idx);
      kept.push(rowOf(m, idx, keepReason(idx, m)));
    }
  }
  const dropped: AssembleMessageRow[] = [];
  before.forEach((m, idx) => {
    if (!keptIdx.has(idx)) {
      dropped.push(rowOf(m, idx, dropReason(idx, m)));
    }
  });
  return { kept, dropped };
}

function buildMeta(
  strategy: string,
  before: UnifiedMessage[],
  after: UnifiedMessage[],
  params?: Record<string, unknown>,
  note?: string,
  detail?: AssembleDetail,
): AssembleMeta {
  return {
    strategy,
    beforeCount: before.length,
    afterCount: after.length,
    beforeChars: estimateChars(before),
    afterChars: estimateChars(after),
    droppedCount: Math.max(0, before.length - after.length),
    params,
    note,
    detail,
  };
}

const RULES_IDENTITY = [
  "不做任何裁剪，完整 messages 原样发给 Adapter。",
  "适合对照：同一历史下，换 recent_n / char_budget 看差异。",
];

const RULES_RECENT_N = [
  "① 前缀连续的 system 消息全部保留（永远不丢指令）。",
  "② 其余消息只保留「最近 recentN 条」（从尾部数）。",
  "③ 若切片起点落在 tool 上，向前回补到带 toolCalls 的 assistant，避免 tool_call 配对断裂。",
  "④ 裁剪的是发给模型的视图；Harness 内存里的完整轨迹仍保留。",
];

const RULES_CHAR_BUDGET = [
  "① 字符数为粗估（content + toolCalls JSON 等），不是真实 tokenizer。",
  "② 前缀 system 先占预算；若 system 已 ≥ maxChars，则只发 system、丢光历史。",
  "③ 从历史尾部向前逐条塞入，直到再加一条会超过 maxChars。",
  "④ 若一条都塞不下：仍强制保留最后 1 条（允许略超预算），避免空对话。",
  "⑤ 同样做 tool 孤儿回补；回补后可能略超预算，配对正确优先。",
];

/** 原样发送：M1/M2 默认 */
export function assembleIdentity(messages: UnifiedMessage[]): AssembleResult {
  const out = messages;
  const { kept, dropped } = diffKeptDropped(
    messages,
    out,
    () => "identity：全部保留",
    () => "",
  );
  return {
    messages: out,
    meta: buildMeta("identity", messages, out, undefined, "未裁剪", {
      rules: RULES_IDENTITY,
      steps: [`输入 ${messages.length} 条 / ${estimateChars(messages)} 字符 → 原样输出`],
      kept,
      dropped,
    }),
  };
}

/**
 * 保留全部前缀 system + 最近 recentN 条非 system。
 * recentN <= 0 时等同只保留 system。
 */
export function assembleRecentN(
  messages: UnifiedMessage[],
  recentN: number,
): AssembleResult {
  const { system, rest } = splitSystemAndRest(messages);
  const n = Math.max(0, recentN);
  const steps: string[] = [
    `参数 recentN=${n}`,
    `拆分：system=${system.length} 条，非 system 历史=${rest.length} 条`,
  ];

  if (rest.length <= n) {
    const out = [...system, ...rest];
    steps.push(`历史条数 ${rest.length} ≤ recentN，无需丢弃`);
    const { kept, dropped } = diffKeptDropped(
      messages,
      out,
      (i, m) => (m.role === "system" ? "前缀 system" : "未超 recentN，保留"),
      () => "（无）",
    );
    return {
      messages: out,
      meta: buildMeta(
        "recent_n",
        messages,
        out,
        { recentN: n },
        "历史未超限，无需裁剪",
        { rules: RULES_RECENT_N, steps, kept, dropped },
      ),
    };
  }

  const restStartInFull = system.length;
  const idealStart = rest.length - n;
  steps.push(
    `理想裁剪点：非 system 下标 ${idealStart}（保留最后 ${n} 条，丢弃前 ${idealStart} 条历史）`,
  );

  let sliceStart = idealStart;
  const repaired = repairToolOrphans(
    messages,
    restStartInFull + sliceStart,
    messages.length,
  );
  if (repaired.start !== restStartInFull + idealStart) {
    steps.push(
      `tool 孤儿回补：起点 ${restStartInFull + idealStart} → ${repaired.start}` +
        (repaired.note ? `（${repaired.note}）` : ""),
    );
  } else {
    steps.push("无需 tool 孤儿回补");
  }

  sliceStart = repaired.start - restStartInFull;
  const keptRest = rest.slice(Math.max(0, sliceStart));
  const out = [...system, ...keptRest];
  steps.push(
    `结果：保留 system ${system.length} + 历史 ${keptRest.length} = ${out.length} 条；` +
      `字符 ${estimateChars(messages)} → ${estimateChars(out)}`,
  );

  const cutAt = repaired.start;
  const { kept, dropped } = diffKeptDropped(
    messages,
    out,
    (i, m) => {
      if (m.role === "system" && i < system.length) return "规则：前缀 system 必留";
      if (i < cutAt) return "回补保留";
      return `最近 ${n} 条窗口内`;
    },
    (i) =>
      i < cutAt
        ? `早于裁剪点 index=${cutAt}，按 recent_n 丢弃`
        : "意外丢弃",
  );

  return {
    messages: out,
    meta: buildMeta(
      "recent_n",
      messages,
      out,
      { recentN: n },
      repaired.note ?? `丢弃较早的 ${messages.length - out.length} 条`,
      { rules: RULES_RECENT_N, steps, kept, dropped },
    ),
  };
}

/**
 * 保留前缀 system，再从尾部向前按字符预算塞入。
 * maxChars 为整份发给模型的粗略字符上限（含 system）。
 */
export function assembleCharBudget(
  messages: UnifiedMessage[],
  maxChars: number,
): AssembleResult {
  const budget = Math.max(0, maxChars);
  const { system, rest } = splitSystemAndRest(messages);
  const systemChars = estimateChars(system);
  const steps: string[] = [
    `参数 maxChars=${budget}（粗估字符，非 token）`,
    `system ${system.length} 条占 ${systemChars} 字符，剩余预算 ${Math.max(0, budget - systemChars)}`,
  ];

  if (systemChars >= budget) {
    const out = [...system];
    steps.push("system 已占满/超过预算 → 历史全部丢弃，只发 system");
    const { kept, dropped } = diffKeptDropped(
      messages,
      out,
      () => "system 必留（即使超预算）",
      () => "预算已被 system 占满，丢弃",
    );
    return {
      messages: out,
      meta: buildMeta(
        "char_budget",
        messages,
        out,
        { maxChars: budget },
        "system 已达/超过预算，历史全部丢弃",
        { rules: RULES_CHAR_BUDGET, steps, kept, dropped },
      ),
    };
  }

  let used = systemChars;
  const picked: UnifiedMessage[] = [];
  const pickLog: string[] = [];
  for (let i = rest.length - 1; i >= 0; i--) {
    const ch = estimateChars([rest[i]]);
    const globalIdx = system.length + i;
    if (used + ch > budget && picked.length > 0) {
      pickLog.push(
        `停：index=${globalIdx} [${rest[i].role}] ${ch}字，若加入 ${used}+${ch}=${used + ch} > ${budget}`,
      );
      break;
    }
    if (used + ch > budget && picked.length === 0) {
      picked.unshift(rest[i]);
      used += ch;
      pickLog.push(
        `例外：至少留最后 1 条 index=${globalIdx} [${rest[i].role}] ${ch}字（允许 ${used} > ${budget}）`,
      );
      break;
    }
    picked.unshift(rest[i]);
    used += ch;
    pickLog.push(
      `纳入 index=${globalIdx} [${rest[i].role}] ${ch}字 → 累计 ${used}/${budget}`,
    );
  }
  steps.push(...pickLog.slice(0, 12));
  if (pickLog.length > 12) {
    steps.push(`…另有 ${pickLog.length - 12} 条纳入日志已省略`);
  }

  const restStartInFull = system.length;
  const firstKept = picked[0];
  let startInFull = firstKept
    ? messages.indexOf(firstKept, restStartInFull)
    : messages.length;
  if (startInFull < 0) startInFull = restStartInFull + (rest.length - picked.length);

  const beforeRepairStart = startInFull;
  const repaired = repairToolOrphans(messages, startInFull, messages.length);
  if (repaired.start !== beforeRepairStart) {
    steps.push(
      `tool 孤儿回补：起点 ${beforeRepairStart} → ${repaired.start}` +
        (repaired.note ? `（${repaired.note}）` : ""),
    );
  }
  const out = [...system, ...messages.slice(repaired.start)];
  steps.push(
    `结果：${out.length} 条 / ${estimateChars(out)} 字符（预算 ${budget}）`,
  );

  const cutAt = repaired.start;
  const { kept, dropped } = diffKeptDropped(
    messages,
    out,
    (i, m) => {
      if (m.role === "system" && i < system.length) return "规则：前缀 system 先占预算";
      return `尾部纳入（累计未超预算或强制留尾）`;
    },
    (i, m) =>
      `未纳入：加入后会超预算（本条 ${estimateChars([m])} 字，裁剪点 index≥${cutAt}）`,
  );

  return {
    messages: out,
    meta: buildMeta(
      "char_budget",
      messages,
      out,
      { maxChars: budget },
      repaired.note ??
        (out.length < messages.length
          ? `按约 ${budget} 字符裁剪`
          : "未超字符预算"),
      { rules: RULES_CHAR_BUDGET, steps, kept, dropped },
    ),
  };
}

/** 根据策略名工厂：Server / 演示页注入用 */
export function createAssembleContext(opts: {
  strategy?: "identity" | "recent_n" | "char_budget";
  recentN?: number;
  maxChars?: number;
}): AssembleContextFn {
  const strategy = opts.strategy ?? "identity";
  if (strategy === "recent_n") {
    const recentN = opts.recentN ?? 6;
    return (messages) => assembleRecentN(messages, recentN);
  }
  if (strategy === "char_budget") {
    const maxChars = opts.maxChars ?? 2000;
    return (messages) => assembleCharBudget(messages, maxChars);
  }
  return assembleIdentity;
}

/**
 * 构造填充用长历史（不含 system / 当前问题）。
 * 仅用于 V5 演示：快速制造「条数多、字符多」的 Context。
 * 内容为占位文本，不含密钥与工具实现。
 */
export function buildSeedHistory(pairCount: number): UnifiedMessage[] {
  const n = Math.max(0, Math.min(pairCount, 50));
  const out: UnifiedMessage[] = [];
  for (let i = 1; i <= n; i++) {
    out.push({
      role: "user",
      content: `【历史 #${i}】这是一段用于撑开 Context 的填充问题。请忽略具体内容，仅作长度演示。附带一些重复占位：上下文工程关注发给模型的视图，而不是把整段轨迹无脑塞进 prompt。`.repeat(
        3,
      ),
    });
    out.push({
      role: "assistant",
      content: `【历史回答 #${i}】收到。这是填充回复，不含工具实现与密钥。Harness 应保留完整轨迹供审计，同时用 assembleContext 裁剪发往模型的 messages。`.repeat(
        3,
      ),
    });
  }
  return out;
}
