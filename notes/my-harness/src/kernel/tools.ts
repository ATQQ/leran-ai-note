/**
 * 本地 mock 工具注册表（M1+）
 *
 * - MOCK_TOOLS：发给模型的 schema（声明）
 * - impl：真正执行的函数（实现）；实现代码永不进入模型 Context
 * - executeMockTool：把 ToolCall 路由到实现，统一返回 ToolResult
 * - 执行前 schema 校验见 validate.ts（Server 走 executeToolWithValidation）
 *
 * M5 起会增加 MCP 后端；本文件保持「本地假数据」演示用。
 */
import type { ToolCall, ToolDef, ToolResult } from "../types.ts";

/** 工具声明：additionalProperties:false 减少模型乱加字段 */
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

/** name → 实现函数；与 schema 一一对应 */
const impl: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  get_weather: async ({ city }) => {
    // 假数据表：只为演示「执行 → 回写」，不访问真实天气 API
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

/**
 * 执行一次工具调用（假定调用方已做过 schema 校验）。
 * 未知工具 / 抛错：仍返回 ToolResult（isError=true），由 loop 写回 Context。
 * 正常路径请用 validate.executeToolWithValidation，避免绕过校验。
 */
export async function executeMockTool(call: ToolCall): Promise<ToolResult> {
  const fn = impl[call.name];
  if (!fn) {
    return {
      toolCallId: call.id,
      name: call.name,
      content: JSON.stringify({
        error: "unknown_tool",
        message: `未知工具名：${call.name}`,
      }),
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
      content: JSON.stringify({ error: "tool_threw", message: String(err) }),
      isError: true,
    };
  }
}
