/**
 * 统一数据结构（内核唯一依赖）
 *
 * 设计目标：
 * - Harness / loop / tools 只认本文件类型，不出现 OpenAI / Anthropic 专有字段名
 *   （如 tool_calls、tool_use、input_schema 等协议细节留在 adapters/*）
 * - Adapter 负责：Unified* ↔ 厂商协议 的双向转换
 * - ToolCall.arguments 在进入内核前必须已是对象，而不是 JSON 字符串
 */

/** 消息角色：与常见 Chat 语义对齐；tool 表示「工具结果写回 Context」 */
export type Role = "system" | "user" | "assistant" | "tool";

/**
 * 统一消息。loop 维护的 Context 就是 UnifiedMessage[]。
 * - assistant + toolCalls：模型决定调用工具
 * - tool + toolCallId：Harness 执行后回写，供下一轮模型阅读
 */
export type UnifiedMessage = {
  role: Role;
  /** 面向用户的文本；assistant 仅工具调用时可为 null */
  content: string | null;
  /** assistant 发起的结构化工具调用列表 */
  toolCalls?: ToolCall[];
  /** tool 消息专用：绑定到哪一次 ToolCall.id */
  toolCallId?: string;
  /** 可选：工具名，便于 Trace / 调试 */
  name?: string;
  /** 可选：推理过程文本（部分兼容网关的 reasoning_content）；不是最终答复 */
  reasoning?: string;
};

/** 工具声明（发给模型的 schema），不含真实实现代码 */
export type ToolDef = {
  name: string;
  description: string;
  /** JSON Schema；建议 additionalProperties: false，减少乱传参 */
  parameters: Record<string, unknown>;
};

/** 一次已解析的工具调用（arguments 已是对象） */
export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

/** 工具执行结果，由 Harness 转成 role:"tool" 的 UnifiedMessage 写回 */
export type ToolResult = {
  toolCallId: string;
  name: string;
  /** 通常为 JSON 字符串；错误时也写入 content，并标 isError */
  content: string;
  isError?: boolean;
};

/**
 * Adapter 流式解析细节（学习向）。
 * - text_fragment：每一帧文本增量（接口逐片返回，我们自己 += 成 accContent）
 * - text_summary：本轮结束后的完整 content + 统计
 * - tool_fragment：每个协议碎片（按 index 累加）全记，便于看 arguments+=
 * - tool_parse_done：拼完后 JSON.parse 的最终 ToolCall[]
 */
export type StreamDetail =
  | {
      kind: "text_fragment";
      /** 本轮第几帧文本增量（从 1 起） */
      seq: number;
      /** 本帧新增的字符串（可能是一字、一词或一小段） */
      delta: string;
      /** 截至本帧拼好的全文 */
      accContent: string;
    }
  | {
      kind: "text_summary";
      deltaCount: number;
      contentLength: number;
      /** 本轮拼好的完整文本（不截断） */
      content: string;
    }
  | {
      kind: "tool_fragment";
      index: number;
      id?: string;
      nameDelta?: string;
      argumentsDelta?: string;
      accName: string;
      accArguments: string;
    }
  | {
      kind: "tool_parse_done";
      toolCalls: ToolCall[];
    };

export type RunEventActor = "harness" | "model" | "tool";
export type RunEventDirection = "out" | "in" | "local";

/**
 * 运行期事件：同时服务 SSE 推送与 Trace 落盘。
 * phase / title / actor / payload 刻意对齐 function-call-demo Viewer，便于对照学习。
 */
export type RunEvent = {
  type:
    | "run_start"
    | "llm_request"
    | "text_delta"
    | "stream_detail"
    | "assistant_message"
    | "tool_start"
    | "tool_end"
    | "run_end"
    | "error";
  /** 与 demo Viewer 类似的阶段名，如 init / request_model / stream_parse */
  phase: string;
  title: string;
  summary: string;
  actor: RunEventActor;
  direction: RunEventDirection;
  payload?: unknown;
  note?: string | null;
  at?: string;
};

export type StreamHandlers = {
  onTextDelta?: (delta: string) => void;
  onEvent?: (event: RunEvent) => void;
};

/**
 * Provider 适配器契约。
 * 入参/出参均为统一类型；内部才允许出现厂商协议字段。
 */
export type LlmAdapter = {
  name: string;
  /**
   * 默认流式调用：
   * - onTextDelta：边收边推文本增量（供浏览器打字机效果）
   * - onStreamDetail：工具碎片 / 文本汇总 / 解析完成（供协议时间线与 Trace）
   * - 返回值：流结束后的完整 assistant UnifiedMessage（含已解析的 toolCalls）
   */
  stream: (input: {
    messages: UnifiedMessage[];
    tools: ToolDef[];
    signal?: AbortSignal;
    onTextDelta?: (delta: string) => void;
    onStreamDetail?: (detail: StreamDetail) => void;
  }) => Promise<UnifiedMessage>;
};

/** runAgent 入参：演示页 / Server 组装后注入 */
export type RunOptions = {
  prompt: string;
  systemPrompt?: string;
  /** 若传入则跳过默认 system+user 组装（多轮续跑时用） */
  messages?: UnifiedMessage[];
  tools: ToolDef[];
  executeTool: (call: ToolCall) => Promise<ToolResult>;
  adapter: LlmAdapter;
  /** 防止死循环；M1 默认 8，M2 起可由页面配置 */
  maxSteps?: number;
  /**
   * 整次 run 墙钟超时（毫秒）。到期后 abort，stopReason=timeout。
   * 与外部 signal 合并：任一触发即停。
   */
  timeoutMs?: number;
  /**
   * 任一工具返回 isError 时是否立刻终止整次 run。
   * false（默认）：错误写回 Context，让模型有机会纠正；true：stopReason=tool_error。
   */
  stopOnToolError?: boolean;
  /** 前端取消 → Server abort → 传到此处 */
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
  /**
   * Context 组装钩子（M3 主战场）。
   * 默认 identity；可在此做截断 / 摘要，再交给 Adapter。
   */
  assembleContext?: (messages: UnifiedMessage[]) => UnifiedMessage[];
};
