/**
 * Agent 循环（Harness 内核）
 *
 * 职责：请求模型 → 解析工具调用 → 执行 → 回写 Context → 再请求，直到：
 * - 模型不再返回工具调用（正常完成）
 * - 达到 maxSteps / 被 AbortSignal 取消 / timeoutMs 到期 / stopOnToolError（强制终止）
 *
 * 边界：
 * - 本文件只使用 Unified* 类型与 camelCase 字段（toolCalls / toolCallId）
 * - 禁止写入 OpenAI 线格式字段名（如 tool_calls）；协议转换留给 Adapter
 * - 对应 Pi：agent-core 的循环 + 事件；对应学习笔记：Harness 强制项（步数/取消/超时）
 */
import type { RunEvent, RunOptions, StreamDetail, UnifiedMessage } from "../types.ts";

/** 给事件补上 ISO 时间戳后交给订阅方（SSE / Trace） */
function emit(onEvent: RunOptions["onEvent"], event: Omit<RunEvent, "at">): void {
  onEvent?.({ ...event, at: new Date().toISOString() });
}

/** M3 之前的默认 Context 策略：原样发送全部历史 */
function identity(messages: UnifiedMessage[]): UnifiedMessage[] {
  return messages;
}

/**
 * 合并外部取消信号与可选超时。
 * - 任一 abort → 合并后的 signal 也会 abort
 * - 超时触发时标记 reason=timeout，便于与用户取消区分
 * - 返回 cleanup：跑完后必须调用，清除定时器
 */
function mergeSignals(
  external: AbortSignal | undefined,
  timeoutMs: number | undefined,
): { signal?: AbortSignal; timedOut: () => boolean; cleanup: () => void } {
  let timedOut = false;
  if (!timeoutMs || timeoutMs <= 0) {
    return { signal: external, timedOut: () => false, cleanup: () => { } };
  }

  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => {
    timedOut = true;
    timeoutCtrl.abort();
  }, timeoutMs);

  const cleanup = () => clearTimeout(timer);

  // Node 20+：AbortSignal.any
  const anyFn = (
    AbortSignal as typeof AbortSignal & {
      any?: (signals: AbortSignal[]) => AbortSignal;
    }
  ).any;

  if (typeof anyFn === "function") {
    const signals = external ? [external, timeoutCtrl.signal] : [timeoutCtrl.signal];
    return {
      signal: anyFn(signals),
      timedOut: () => timedOut,
      cleanup,
    };
  }

  // 无 any 时：把 external abort 桥到 timeoutCtrl
  if (external) {
    if (external.aborted) {
      cleanup();
      timeoutCtrl.abort();
    } else {
      external.addEventListener(
        "abort",
        () => {
          cleanup();
          timeoutCtrl.abort();
        },
        { once: true },
      );
    }
  }
  return {
    signal: timeoutCtrl.signal,
    timedOut: () => timedOut,
    cleanup,
  };
}

/** 把 Adapter 的 StreamDetail 转成人类可读的 title / summary */
function describeStreamDetail(
  roundLabel: string,
  detail: StreamDetail,
): { title: string; summary: string; note: string | null } {
  if (detail.kind === "text_fragment") {
    return {
      title: `${roundLabel} · 文本碎片 #${detail.seq}`,
      // 事件流 / Trace 目录直接展示本帧与累计全文，不省略
      summary: `+${JSON.stringify(detail.delta)} → ${JSON.stringify(detail.accContent)}`,
      note: "接口逐帧返回文本；delta=本帧，accContent=自拼累计",
    };
  }
  if (detail.kind === "text_summary") {
    return {
      title: `${roundLabel} · 文本流汇总`,
      summary: `共 ${detail.deltaCount} 帧，总长度 ${detail.contentLength}`,
      note: "本轮全部 text_fragment 拼完后的完整 content",
    };
  }
  if (detail.kind === "tool_fragment") {
    const bits: string[] = [`#${detail.index}`];
    if (detail.nameDelta) bits.push(`name+=${JSON.stringify(detail.nameDelta)}`);
    if (detail.argumentsDelta) {
      const d =
        detail.argumentsDelta.length > 40
          ? `${detail.argumentsDelta.slice(0, 40)}…`
          : detail.argumentsDelta;
      bits.push(`arguments+=${JSON.stringify(d)}`);
    }
    if (!detail.nameDelta && !detail.argumentsDelta && detail.id) {
      bits.push(`id=${detail.id}`);
    }
    return {
      title: `${roundLabel} · 工具碎片 #${detail.index}`,
      summary: bits.join(" · "),
      note: "同一 index 的多帧拼到同一桶；禁止半截 JSON 就执行",
    };
  }
  // tool_parse_done
  const names = detail.toolCalls.map((c) => c.name).join(", ");
  return {
    title: `${roundLabel} · 工具解析完成`,
    summary: `${detail.toolCalls.length} 个 ToolCall：${names || "(无)"}`,
    note: "arguments 已 JSON.parse 为对象，可供 Harness 执行",
  };
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
  const stopOnToolError = opts.stopOnToolError ?? false;
  const { signal, timedOut, cleanup } = mergeSignals(opts.signal, opts.timeoutMs);

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
    payload: {
      messages: structuredClone(messages),
      toolCount: opts.tools.length,
      maxSteps,
      timeoutMs: opts.timeoutMs ?? null,
      stopOnToolError,
    },
  });

  let steps = 0;
  let finalText: string | null = null;
  // completed：模型给出最终文本；其余为 Harness 强制终止
  let stopReason = "completed";

  try {
    while (steps < maxSteps) {
      // 每轮开始前检查取消 / 超时
      if (signal?.aborted) {
        stopReason = timedOut() ? "timeout" : "aborted";
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
        signal,
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
        onStreamDetail: (detail) => {
          // 工具碎片 / 文本汇总 / 解析完成 → 推 UI 且写入 Trace（见 Server 落盘策略）
          const desc = describeStreamDetail(roundLabel, detail);
          emit(opts.onEvent, {
            type: "stream_detail",
            phase: "stream_parse",
            title: desc.title,
            summary: desc.summary,
            actor: "model",
            direction: "in",
            payload: detail,
            note: desc.note,
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
      let hitToolError = false;
      for (const call of calls) {
        if (signal?.aborted) {
          stopReason = timedOut() ? "timeout" : "aborted";
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
          summary: result.isError ? "工具返回错误（已回写）" : "结果已写入 Context",
          actor: "harness",
          direction: "local",
          payload: { appended: toolMessage, isError: result.isError ?? false },
          note: result.isError
            ? "校验失败或执行失败；不静默吞掉"
            : null,
        });

        if (result.isError && stopOnToolError) {
          hitToolError = true;
          stopReason = "tool_error";
          break;
        }
      }

      if (stopReason === "aborted" || stopReason === "timeout" || hitToolError) break;
      // 若仍有步数配额：回到 while 顶部再请求模型（基于工具结果继续推理）
    }

    // 循环因 maxSteps 退出，且从未拿到「无工具调用」的最终答复
    if (stopReason === "completed" && finalText === null && !signal?.aborted) {
      stopReason = "max_steps";
    }
    if (signal?.aborted && stopReason === "completed") {
      stopReason = timedOut() ? "timeout" : "aborted";
    }
  } catch (err) {
    // Adapter fetch 被 abort 时会抛 AbortError；区分超时与用户取消
    const name = err instanceof Error ? err.name : "";
    if (name === "AbortError" || signal?.aborted) {
      stopReason = timedOut() ? "timeout" : "aborted";
    } else {
      cleanup();
      throw err;
    }
  } finally {
    cleanup();
  }

  emit(opts.onEvent, {
    type: "run_end",
    phase: "final_answer",
    title: "运行结束",
    summary: `stopReason=${stopReason}`,
    actor: "harness",
    direction: "local",
    payload: {
      finalText,
      stopReason,
      steps,
      maxSteps,
      timeoutMs: opts.timeoutMs ?? null,
      stopOnToolError,
    },
  });

  return { messages, finalText, stopReason };
}
