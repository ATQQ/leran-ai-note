import type { RunEvent, RunOptions, UnifiedMessage } from "../types.ts";

function emit(onEvent: RunOptions["onEvent"], event: Omit<RunEvent, "at">): void {
  onEvent?.({ ...event, at: new Date().toISOString() });
}

function identity(messages: UnifiedMessage[]): UnifiedMessage[] {
  return messages;
}

/**
 * Provider 无关的 Agent 循环。
 * 禁止在此文件使用厂商协议字段名（如 tool_calls、role:"tool" 字面协议结构）。
 */
export async function runAgent(opts: RunOptions): Promise<{
  messages: UnifiedMessage[];
  finalText: string | null;
  stopReason: string;
}> {
  const maxSteps = opts.maxSteps ?? 8;
  const assemble = opts.assembleContext ?? identity;
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
  let stopReason = "completed";

  while (steps < maxSteps) {
    if (opts.signal?.aborted) {
      stopReason = "aborted";
      break;
    }

    steps += 1;
    const roundLabel = `ROUND${steps}`;
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

    const assistant = await opts.adapter.stream({
      messages: forModel,
      tools: opts.tools,
      signal: opts.signal,
      onTextDelta: (delta) => {
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

    if (calls.length === 0) {
      finalText = assistant.content;
      stopReason = "completed";
      break;
    }

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
  }

  // 用尽步数仍未得到无工具调用的最终答复
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
