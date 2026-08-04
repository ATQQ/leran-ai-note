/**
 * M8 · 子 Agent
 *
 * 形态：父 Agent 通过工具 run_subagent 拉起一次独立的 runAgent。
 * - 独立 messages（不继承父完整历史）
 * - 更小的 maxSteps
 * - 工具子集（默认 get_weather / add，禁止套娃）
 * - 事件带 parentToolCallId，便于 UI 缩进展示
 */
import { runAgent } from "./loop.ts";
import { SUBAGENT_TOOLS } from "./tools.ts";
import type {
  LlmAdapter,
  RunEvent,
  ToolCall,
  ToolDef,
  ToolResult,
} from "../types.ts";

export type SubagentRunOpts = {
  call: ToolCall;
  adapter: LlmAdapter;
  executeTool: (call: ToolCall) => Promise<ToolResult>;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
  /** 防止无限套娃；Server 层也应拒绝 depth>0 再调 run_subagent */
  depth?: number;
  tools?: ToolDef[];
};

export async function executeRunSubagent(
  opts: SubagentRunOpts,
): Promise<ToolResult> {
  const task = String(opts.call.arguments.task ?? "").trim();
  const maxStepsRaw = opts.call.arguments.maxSteps;
  const maxSteps =
    typeof maxStepsRaw === "number" && maxStepsRaw > 0
      ? Math.min(8, Math.floor(maxStepsRaw))
      : 4;
  const depth = opts.depth ?? 0;

  if (!task) {
    return {
      toolCallId: opts.call.id,
      name: opts.call.name,
      content: JSON.stringify({
        error: "bad_args",
        message: "task 不能为空",
      }),
      isError: true,
    };
  }
  if (depth > 0) {
    return {
      toolCallId: opts.call.id,
      name: opts.call.name,
      content: JSON.stringify({
        error: "subagent_depth_exceeded",
        message: "本演示禁止子 Agent 再调 run_subagent",
        depth,
      }),
      isError: true,
    };
  }

  const tools = opts.tools ?? SUBAGENT_TOOLS;
  const parentId = opts.call.id;

  opts.onEvent?.({
    type: "subagent_start",
    phase: "subagent",
    title: "子 Agent 启动",
    summary: `task=${task.slice(0, 80)}${task.length > 80 ? "…" : ""} · maxSteps=${maxSteps}`,
    actor: "harness",
    direction: "local",
    payload: {
      parentToolCallId: parentId,
      task,
      maxSteps,
      tools: tools.map((t) => t.name),
      depth,
    },
    note: "独立 Context；结果以 ToolResult 回写父循环",
    at: new Date().toISOString(),
  });

  const childOnEvent = (event: RunEvent) => {
    const payload =
      event.payload && typeof event.payload === "object"
        ? { ...(event.payload as object), parentToolCallId: parentId, subagent: true }
        : { parentToolCallId: parentId, subagent: true, inner: event.payload };
    opts.onEvent?.({
      ...event,
      title: `[子] ${event.title}`,
      payload,
    });
  };

  try {
    const result = await runAgent({
      prompt: task,
      systemPrompt:
        "你是子 Agent。只解决用户交给你的子任务。" +
        "需要天气或加法时必须调用工具；完成后用中文给出简短结论。" +
        "不要调用 run_subagent。",
      tools,
      executeTool: opts.executeTool,
      adapter: opts.adapter,
      maxSteps,
      signal: opts.signal,
      onEvent: childOnEvent,
      toolExecution: "parallel",
    });

    opts.onEvent?.({
      type: "subagent_end",
      phase: "subagent",
      title: "子 Agent 结束",
      summary: `stopReason=${result.stopReason}`,
      actor: "harness",
      direction: "local",
      payload: {
        parentToolCallId: parentId,
        stopReason: result.stopReason,
        finalText: result.finalText,
        messageCount: result.messages.length,
      },
      at: new Date().toISOString(),
    });

    return {
      toolCallId: opts.call.id,
      name: opts.call.name,
      content: JSON.stringify({
        finalText: result.finalText,
        stopReason: result.stopReason,
        stepsHint: "详见 Trace 中 [子] 前缀事件",
      }),
      isError: result.stopReason === "error",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    opts.onEvent?.({
      type: "subagent_end",
      phase: "subagent",
      title: "子 Agent 异常结束",
      summary: message,
      actor: "harness",
      direction: "local",
      payload: { parentToolCallId: parentId, error: message },
      at: new Date().toISOString(),
    });
    return {
      toolCallId: opts.call.id,
      name: opts.call.name,
      content: JSON.stringify({ error: "subagent_failed", message }),
      isError: true,
    };
  }
}
