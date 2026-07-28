export type Role = "system" | "user" | "assistant" | "tool";

export type UnifiedMessage = {
  role: Role;
  content: string | null;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  reasoning?: string;
};

export type ToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ToolResult = {
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
};

export type RunEventActor = "harness" | "model" | "tool";
export type RunEventDirection = "out" | "in" | "local";

/** 与 function-call-demo Viewer 的 phase / title / actor / payload 对齐，并扩展流式增量 */
export type RunEvent = {
  type:
    | "run_start"
    | "llm_request"
    | "text_delta"
    | "assistant_message"
    | "tool_start"
    | "tool_end"
    | "run_end"
    | "error";
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

export type LlmAdapter = {
  name: string;
  stream: (input: {
    messages: UnifiedMessage[];
    tools: ToolDef[];
    signal?: AbortSignal;
    onTextDelta?: (delta: string) => void;
  }) => Promise<UnifiedMessage>;
};

export type RunOptions = {
  prompt: string;
  systemPrompt?: string;
  messages?: UnifiedMessage[];
  tools: ToolDef[];
  executeTool: (call: ToolCall) => Promise<ToolResult>;
  adapter: LlmAdapter;
  /** M1 安全上限；M2 起可从页面配置 */
  maxSteps?: number;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
  assembleContext?: (messages: UnifiedMessage[]) => UnifiedMessage[];
};
