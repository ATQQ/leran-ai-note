/**
 * Agent 循环（Harness 内核）
 *
 * 职责：请求模型 → 解析工具调用 → 执行 → 回写 Context → 再请求，直到：
 * - 模型不再返回工具调用（正常完成）
 * - 达到 maxSteps / 被 AbortSignal 取消（强制终止）
 *
 * 边界：
 * - 本文件只使用 Unified* 类型与 camelCase 字段（toolCalls / toolCallId）
 * - 禁止写入 OpenAI 线格式字段名（如 tool_calls）；协议转换留给 Adapter
 * - 对应 Pi：agent-core 的循环 + 事件；对应学习笔记：Harness 强制项（步数/取消）
 */
import type { RunEvent, RunOptions, UnifiedMessage } from "../types.ts";

/** 给事件补上 ISO 时间戳后交给订阅方（SSE / Trace） */
function emit(onEvent: RunOptions["onEvent"], event: Omit<RunEvent, "at">): void {
  onEvent?.({ ...event, at: new Date().toISOString() });
}

/** M3 之前的默认 Context 策略：原样发送全部历史 */
function identity(messages: UnifiedMessage[]): UnifiedMessage[] {
  return messages;
}

/**
 * 执行一次 Agent Run。
 * @returns messages 为完整轨迹；finalText 为无工具调用时的最终答复；stopReason 说明为何结束
 */
export async function runAgent(opts: RunOptions): Promise<{
  messages: UnifiedMessage[];
  finalText: string | null;
  stopReason: string;
}> {
  const maxSteps = opts.maxSteps ?? 8;
  const assemble = opts.assembleContext ?? identity;

  // 初始 Context：system 约束「必须用工具」+ 用户 prompt
  const messages: UnifiedMessage[] = opts.messages
    ? [...opts.messages]
    : [
        {
          role: "system",
          content:
            opts.systemPrompt ??
            "你是助手。需要天气或加法时必须调用工具，不要编造工具结果。",
        },
        { role: "user", content: opts.prompt },
      ];

  emit(opts.onEvent, {
    type: "run_start",
    phase: "init",
    title: "初始化 Context",
    summary: "组装 system + user，并准备 tools schema",
    actor: "harness",
    direction: "local",
    payload: { messages: structuredClone(messages), toolCount: opts.tools.length },
  });

  let steps = 0;
  let finalText: string | null = null;
  // completed：模型给出最终文本；aborted / max_steps：Harness 强制终止
  let stopReason = "completed";

  while (steps < maxSteps) {
    // 每轮开始前检查取消（前端断开 SSE 会 abort）
    if (opts.signal?.aborted) {
      stopReason = "aborted";
      break;
    }

    steps += 1;
    const roundLabel = `ROUND${steps}`;
    // 发往模型前走钩子：M3 可在此裁剪历史
    const forModel = assemble(messages);

    emit(opts.onEvent, {
      type: "llm_request",
      phase: "request_model",
      title: `${roundLabel} · 请求模型`,
      summary: `经 Adapter「${opts.adapter.name}」流式请求，messages=${forModel.length}`,
      actor: "harness",
      direction: "out",
      payload: {
        adapter: opts.adapter.name,
        messageCount: forModel.length,
        toolNames: opts.tools.map((t) => t.name),
      },
    });

    // Adapter 内部做协议转换 + 流式解析；此处只拿到统一 assistant 消息
    const assistant = await opts.adapter.stream({
      messages: forModel,
      tools: opts.tools,
      signal: opts.signal,
      onTextDelta: (delta) => {
        // 增量只推 SSE，不逐条写入 Trace（避免刷屏；完整内容在 assistant_message）
        emit(opts.onEvent, {
          type: "text_delta",
          phase: "stream",
          title: `${roundLabel} · text_delta`,
          summary: delta,
          actor: "model",
          direction: "in",
          payload: { delta },
        });
      },
    });

    messages.push(assistant);

    const calls = assistant.toolCalls ?? [];
    emit(opts.onEvent, {
      type: "assistant_message",
      phase: "model_response",
      title: `${roundLabel} · 模型响应`,
      summary: calls.length
        ? `返回 ${calls.length} 个工具调用`
        : "返回最终文本（无工具调用）",
      actor: "model",
      direction: "in",
      payload: {
        content: assistant.content,
        toolCalls: calls,
        reasoning: assistant.reasoning ?? null,
      },
      note: calls.length
        ? "执行依据是结构化工具调用，不是思考文本"
        : null,
    });

    // 无工具调用 → 正常结束（最终答复）
    if (calls.length === 0) {
      finalText = assistant.content;
      stopReason = "completed";
      break;
    }

    // 有工具调用 → Harness 调度执行并回写（执行依据是结构，不是自然语言）
    for (const call of calls) {
      if (opts.signal?.aborted) {
        stopReason = "aborted";
        break;
      }

      emit(opts.onEvent, {
        type: "tool_start",
        phase: "execute_tool",
        title: `执行工具 · ${call.name}`,
        summary: `id=${call.id}`,
        actor: "tool",
        direction: "local",
        payload: { toolCallId: call.id, name: call.name, arguments: call.arguments },
      });

      const result = await opts.executeTool(call);

      // 统一消息里用 role:"tool" + toolCallId 绑定；Adapter 出站时再映射成厂商线格式
      const toolMessage: UnifiedMessage = {
        role: "tool",
        content: result.content,
        toolCallId: result.toolCallId,
        name: result.name,
      };
      messages.push(toolMessage);

      emit(opts.onEvent, {
        type: "tool_end",
        phase: "append_tool_result",
        title: `回写工具结果 · ${call.name}`,
        summary: result.isError ? "工具返回错误" : "结果已写入 Context",
        actor: "harness",
        direction: "local",
        payload: { appended: toolMessage, isError: result.isError ?? false },
      });
    }

    if (stopReason === "aborted") break;
    // 若仍有步数配额：回到 while 顶部再请求模型（基于工具结果继续推理）
  }

  // 循环因 maxSteps 退出，且从未拿到「无工具调用」的最终答复
  if (stopReason === "completed" && finalText === null && !opts.signal?.aborted) {
    stopReason = "max_steps";
  }

  emit(opts.onEvent, {
    type: "run_end",
    phase: "final_answer",
    title: "运行结束",
    summary: `stopReason=${stopReason}`,
    actor: "harness",
    direction: "local",
    payload: { finalText, stopReason, steps },
  });

  return { messages, finalText, stopReason };
}
