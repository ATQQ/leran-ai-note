/**
 * 本地 mock 工具注册表（M1+）
 *
 * - MOCK_TOOLS：发给模型的 schema（声明）
 * - impl：真正执行的函数（实现）；实现代码永不进入模型 Context
 * - executeMockTool：把 ToolCall 路由到实现，统一返回 ToolResult
 * - 执行前 schema 校验见 validate.ts（Server 走 executeToolWithValidation）
 *
 * M5：MCP 后端见 src/mcp/；本文件保持「本地假数据」演示用。
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
  {
    name: "wipe_demo",
    description:
      "【高风险】清空演示暂存区（假操作）。M7 用于确认门闩：未确认不得执行。",
    risk: "high",
    parameters: {
      type: "object",
      properties: {
        confirmToken: {
          type: "string",
          description: "任意非空字符串即可（演示用）",
        },
      },
      required: ["confirmToken"],
      additionalProperties: false,
    },
  },
  {
    name: "run_subagent",
    description:
      "【子 Agent】把子任务交给独立 Agent 循环（独立 Context、有限步数、工具子集）。" +
      "适合调研/计算子问题；不要用它做高风险写操作。",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "交给子 Agent 的任务描述（完整、自包含）",
        },
        maxSteps: {
          type: "number",
          description: "子循环最大步数，默认 4",
        },
      },
      required: ["task"],
      additionalProperties: false,
    },
  },
];

/** 子 Agent 允许的工具（禁止再套娃 run_subagent / wipe） */
export const SUBAGENT_TOOLS: ToolDef[] = MOCK_TOOLS.filter(
  (t) => t.name === "get_weather" || t.name === "add",
);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** name → 实现函数；与 schema 一一对应（run_subagent 由 Server 注入，不在此实现） */
const impl: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  get_weather: async ({ city }) => {
    // 故意延迟：便于 M8 观察 parallel vs sequential 的耗时重叠
    await sleep(400);
    const table: Record<string, { temp_c: number; condition: string }> = {
      北京: { temp_c: 28, condition: "晴" },
      上海: { temp_c: 31, condition: "多云" },
      深圳: { temp_c: 33, condition: "雷阵雨" },
    };
    const key = String(city ?? "");
    const hit = table[key] ?? { temp_c: 26, condition: "未知城市（演示默认值）" };
    return { city: key, ...hit, source: "local-mock" };
  },
  add: async ({ a, b }) => {
    await sleep(400);
    return { a, b, sum: Number(a) + Number(b) };
  },
  wipe_demo: async ({ confirmToken }) => ({
    wiped: true,
    confirmToken: String(confirmToken ?? ""),
    note: "演示：未真正删除任何文件；若你看到本结果，说明确认门闩已放行",
  }),
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
