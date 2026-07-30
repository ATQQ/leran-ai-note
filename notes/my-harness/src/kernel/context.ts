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

function buildMeta(
  strategy: string,
  before: UnifiedMessage[],
  after: UnifiedMessage[],
  params?: Record<string, unknown>,
  note?: string,
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
  };
}

/** 原样发送：M1/M2 默认 */
export function assembleIdentity(messages: UnifiedMessage[]): AssembleResult {
  const out = messages;
  return {
    messages: out,
    meta: buildMeta("identity", messages, out, undefined, "未裁剪"),
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

  if (rest.length <= n) {
    const out = [...system, ...rest];
    return {
      messages: out,
      meta: buildMeta("recent_n", messages, out, { recentN: n }, "历史未超限，无需裁剪"),
    };
  }

  const restStartInFull = system.length;
  let sliceStart = rest.length - n; // 相对 rest
  const repaired = repairToolOrphans(
    messages,
    restStartInFull + sliceStart,
    messages.length,
  );
  sliceStart = repaired.start - restStartInFull;
  const keptRest = rest.slice(Math.max(0, sliceStart));
  const out = [...system, ...keptRest];

  return {
    messages: out,
    meta: buildMeta(
      "recent_n",
      messages,
      out,
      { recentN: n },
      repaired.note ?? `丢弃较早的 ${messages.length - out.length} 条`,
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

  if (systemChars >= budget) {
    // system 已占满：仍发送 system（保证有指令），并注明超预算
    return {
      messages: [...system],
      meta: buildMeta(
        "char_budget",
        messages,
        system,
        { maxChars: budget },
        "system 已达/超过预算，历史全部丢弃",
      ),
    };
  }

  let used = systemChars;
  const picked: UnifiedMessage[] = [];
  for (let i = rest.length - 1; i >= 0; i--) {
    const ch = estimateChars([rest[i]]);
    if (used + ch > budget && picked.length > 0) break;
    if (used + ch > budget && picked.length === 0) {
      // 至少保留最后一条（即使超一点），避免空对话
      picked.unshift(rest[i]);
      used += ch;
      break;
    }
    picked.unshift(rest[i]);
    used += ch;
  }

  // 回补 tool 孤儿：在完整数组里定位 picked 起点
  const restStartInFull = system.length;
  const firstKept = picked[0];
  let startInFull = firstKept
    ? messages.indexOf(firstKept, restStartInFull)
    : messages.length;
  if (startInFull < 0) startInFull = restStartInFull + (rest.length - picked.length);

  const repaired = repairToolOrphans(messages, startInFull, messages.length);
  const out = [...system, ...messages.slice(repaired.start)];

  // 若回补后再次超预算，仍以配对正确优先（学习演示）
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
