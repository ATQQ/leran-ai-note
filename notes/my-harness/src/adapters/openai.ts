/**
 * OpenAI Chat Completions 兼容 Adapter（一期默认 Provider）
 *
 * 出站：UnifiedMessage[] + ToolDef[] → messages / tools / tool_choice，且 stream:true
 * 入站：解析 SSE chunk → onTextDelta + 流结束时的完整 UnifiedMessage
 *
 * 注意：
 * - 厂商字段（tool_calls、role:"tool"、tool_call_id）只出现在本文件
 * - 工具 arguments 在流式场景是分片字符串，必须拼完再 JSON.parse，再交给内核
 * - 部分中转站会带 reasoning_content：记入 UnifiedMessage.reasoning，不当最终答复
 */
import type { LlmAdapter, ToolDef, UnifiedMessage } from "../types.ts";

type OpenAIConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

/** 流式 tool_calls 按 index 累加的中间状态（协议侧仍是字符串 arguments） */
type OpenAIToolCallAcc = {
  id: string;
  name: string;
  arguments: string;
};

/** 统一消息 → OpenAI messages（含 tool / tool_calls 线格式） */
function toOpenAIMessages(messages: UnifiedMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      out.push({
        role: "tool",
        tool_call_id: m.toolCallId,
        content: m.content ?? "",
      });
      continue;
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      out.push({
        role: "assistant",
        content: m.content,
        // 出站时 arguments 必须再序列化成 JSON 字符串（协议要求）
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: {
            name: c.name,
            arguments: JSON.stringify(c.arguments ?? {}),
          },
        })),
      });
      continue;
    }
    out.push({
      role: m.role,
      content: m.content,
    });
  }
  return out;
}

/** 统一 ToolDef → OpenAI tools[]（type:function 包裹） */
function toOpenAITools(tools: ToolDef[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/** 流结束后把拼接好的 arguments 字符串解析为对象，供内核使用 */
function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
    return { _raw: v };
  } catch {
    // 解析失败也返回可审计对象，避免内核拿到半截字符串
    return { _parseError: true, _raw: raw };
  }
}

/**
 * 把 HTTP body 拆成 SSE 文本行。
 * Chat Completions 流式响应通常是：data: {...}\n\n ，最后 data: [DONE]
 */
async function* iterateSseLines(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // 按行切；最后一段可能不完整，留在 buffer
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        yield line;
      }
    }
    if (buffer) yield buffer;
  } finally {
    reader.releaseLock();
  }
}

/** 工厂：注入 baseUrl / apiKey / model，返回符合 LlmAdapter 的对象 */
export function createOpenAIAdapter(config: OpenAIConfig): LlmAdapter {
  const base = config.baseUrl.replace(/\/$/, "");

  return {
    name: "openai",

    async stream({ messages, tools, signal, onTextDelta }) {
      const url = `${base}/chat/completions`;
      const body = {
        model: config.model,
        messages: toOpenAIMessages(messages),
        tools: toOpenAITools(tools),
        // auto：模型自行决定是否调工具
        tool_choice: "auto",
        // 默认流式：本项目不允许把非流式当作默认路径
        stream: true,
      };

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`OpenAI HTTP ${res.status}: ${errText.slice(0, 500)}`);
      }
      if (!res.body) throw new Error("OpenAI response body is empty");

      let content = "";
      let reasoning = "";
      // index → 累加中的 tool_call（流式 name/arguments 可能分多片到达）
      const toolAcc = new Map<number, OpenAIToolCallAcc>();

      for await (const line of iterateSseLines(res.body, signal)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue; // 心跳/注释行
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") break;

        let json: {
          choices?: Array<{
            delta?: {
              content?: string | null;
              reasoning_content?: string | null;
              tool_calls?: Array<{
                index?: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
          }>;
        };
        try {
          json = JSON.parse(data);
        } catch {
          continue; // 坏包跳过，不中断整次流
        }

        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;

        // 文本增量：立刻回调，供前端打字机展示
        if (typeof delta.content === "string" && delta.content) {
          content += delta.content;
          onTextDelta?.(delta.content);
        }
        // 推理增量：只累加，默认不推给用户可见区（由上层决定是否展示）
        if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
          reasoning += delta.reasoning_content;
        }

        // 工具调用增量：按 index 拼接，流结束后再 parse（禁止半截 JSON 就执行）
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            let acc = toolAcc.get(idx);
            if (!acc) {
              acc = { id: "", name: "", arguments: "" };
              toolAcc.set(idx, acc);
            }
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name += tc.function.name;
            if (tc.function?.arguments) acc.arguments += tc.function.arguments;
          }
        }
      }

      // 流结束：转成统一 ToolCall（arguments 已是对象）
      const toolCalls = [...toolAcc.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, acc]) => ({
          id: acc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
          name: acc.name,
          arguments: parseArgs(acc.arguments),
        }));

      const message: UnifiedMessage = {
        role: "assistant",
        content: content || null,
        toolCalls: toolCalls.length ? toolCalls : undefined,
        reasoning: reasoning || undefined,
      };
      return message;
    },
  };
}

/** Trace 落盘用：记录发给模型的 tools schema（OpenAI 线格式，便于对照 demo） */
export function openaiToolsSchemaForTrace(tools: ToolDef[]): unknown {
  return toOpenAITools(tools);
}
