import type { ToolCall, ToolDef, ToolResult } from "./types.ts";

export const MOCK_TOOLS: ToolDef[] = [
  {
    name: "get_weather",
    description: "查询指定城市的当前天气（演示用本地假数据）",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", description: "城市名，如 北京、上海" },
      },
      required: ["city"],
      additionalProperties: false,
    },
  },
  {
    name: "add",
    description: "计算两个数字之和",
    parameters: {
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" },
      },
      required: ["a", "b"],
      additionalProperties: false,
    },
  },
];

const impl: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  get_weather: async ({ city }) => {
    const table: Record<string, { temp_c: number; condition: string }> = {
      北京: { temp_c: 28, condition: "晴" },
      上海: { temp_c: 31, condition: "多云" },
      深圳: { temp_c: 33, condition: "雷阵雨" },
    };
    const key = String(city ?? "");
    const hit = table[key] ?? { temp_c: 26, condition: "未知城市（演示默认值）" };
    return { city: key, ...hit, source: "local-mock" };
  },
  add: async ({ a, b }) => ({ a, b, sum: Number(a) + Number(b) }),
};

export async function executeMockTool(call: ToolCall): Promise<ToolResult> {
  const fn = impl[call.name];
  if (!fn) {
    return {
      toolCallId: call.id,
      name: call.name,
      content: JSON.stringify({ error: `unknown tool: ${call.name}` }),
      isError: true,
    };
  }
  try {
    const result = await fn(call.arguments);
    return {
      toolCallId: call.id,
      name: call.name,
      content: JSON.stringify(result),
    };
  } catch (err) {
    return {
      toolCallId: call.id,
      name: call.name,
      content: JSON.stringify({ error: String(err) }),
      isError: true,
    };
  }
}
