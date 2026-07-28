import type { LlmAdapter, ToolDef, UnifiedMessage } from "../types.ts";

type OpenAIConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

type OpenAIToolCallAcc = {
  id: string;
  name: string;
  arguments: string;
};

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

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
    return { _raw: v };
  } catch {
    return { _parseError: true, _raw: raw };
  }
}

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
        tool_choice: "auto",
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
      const toolAcc = new Map<number, OpenAIToolCallAcc>();

      for await (const line of iterateSseLines(res.body, signal)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
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
          continue;
        }

        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;

        if (typeof delta.content === "string" && delta.content) {
          content += delta.content;
          onTextDelta?.(delta.content);
        }
        if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
          reasoning += delta.reasoning_content;
        }

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

export function openaiToolsSchemaForTrace(tools: ToolDef[]): unknown {
  return toOpenAITools(tools);
}
