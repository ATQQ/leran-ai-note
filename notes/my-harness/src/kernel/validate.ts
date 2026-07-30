/**
 * 工具调用执行前校验（M2）
 *
 * 职责：在真正执行 impl 之前，按 ToolDef.parameters（JSON Schema 子集）检查：
 * - 工具名是否在注册表
 * - arguments 是否为可解析对象（含 Adapter 留下的 _parseError）
 * - required / 类型 / additionalProperties
 *
 * 失败时返回 isError=true 的 ToolResult，由 loop 回写 Context（不静默吞掉）。
 * 本文件不出现厂商协议字段名。
 */
import type { ToolCall, ToolDef, ToolResult } from "../types.ts";

/** 从 tools 列表按 name 查找声明；找不到则未知工具 */
function findDef(tools: ToolDef[], name: string): ToolDef | undefined {
  return tools.find((t) => t.name === name);
}

/**
 * 校验单个 JSON Schema 属性值是否匹配 type。
 * 仅覆盖演示需要的子集：string / number / integer / boolean / object / array。
 */
function typeMatches(expected: string | undefined, value: unknown): boolean {
  if (!expected) return true;
  if (expected === "integer") {
    return typeof value === "number" && Number.isInteger(value);
  }
  if (expected === "number") return typeof value === "number" && !Number.isNaN(value);
  if (expected === "string") return typeof value === "string";
  if (expected === "boolean") return typeof value === "boolean";
  if (expected === "object") {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  if (expected === "array") return Array.isArray(value);
  return true;
}

/**
 * 按 ToolDef.parameters 校验 arguments。
 * @returns 错误信息字符串；通过则返回 null
 */
export function checkArgumentsAgainstSchema(
  args: Record<string, unknown>,
  parameters: Record<string, unknown>,
): string | null {
  // Adapter 流结束 JSON.parse 失败时会留下标记，视为非法参数
  if (args._parseError === true) {
    return `arguments JSON 解析失败：${String(args._raw ?? "")}`;
  }

  const required = Array.isArray(parameters.required)
    ? (parameters.required as string[])
    : [];
  for (const key of required) {
    if (!(key in args) || args[key] === undefined) {
      return `缺少必填参数：${key}`;
    }
  }

  const properties =
    parameters.properties && typeof parameters.properties === "object"
      ? (parameters.properties as Record<string, { type?: string }>)
      : {};

  for (const [key, value] of Object.entries(args)) {
    // 内部标记字段不参与 schema 检查
    if (key.startsWith("_")) continue;
    const prop = properties[key];
    if (!prop) {
      if (parameters.additionalProperties === false) {
        return `不允许的额外参数：${key}`;
      }
      continue;
    }
    if (!typeMatches(prop.type, value)) {
      return `参数 ${key} 类型应为 ${prop.type}，实际为 ${typeof value}`;
    }
  }

  return null;
}

/**
 * 执行前完整校验。
 * @returns 若非法则返回错误 ToolResult；合法返回 null（调用方继续执行）
 */
export function validateToolCall(
  call: ToolCall,
  tools: ToolDef[],
): ToolResult | null {
  const def = findDef(tools, call.name);
  if (!def) {
    return {
      toolCallId: call.id,
      name: call.name,
      content: JSON.stringify({
        error: "unknown_tool",
        message: `未知工具名：${call.name}`,
        knownTools: tools.map((t) => t.name),
      }),
      isError: true,
    };
  }

  if (!call.arguments || typeof call.arguments !== "object" || Array.isArray(call.arguments)) {
    return {
      toolCallId: call.id,
      name: call.name,
      content: JSON.stringify({
        error: "invalid_arguments",
        message: "arguments 必须是对象",
      }),
      isError: true,
    };
  }

  const schemaErr = checkArgumentsAgainstSchema(call.arguments, def.parameters);
  if (schemaErr) {
    return {
      toolCallId: call.id,
      name: call.name,
      content: JSON.stringify({
        error: "schema_validation_failed",
        message: schemaErr,
        arguments: call.arguments,
      }),
      isError: true,
    };
  }

  return null;
}

/**
 * 带校验的执行包装：先 validate，通过后再调 execute。
 * Server / 演示页应走此入口，而不是直接 executeMockTool。
 */
export async function executeToolWithValidation(
  call: ToolCall,
  tools: ToolDef[],
  execute: (call: ToolCall) => Promise<ToolResult>,
): Promise<ToolResult> {
  const rejected = validateToolCall(call, tools);
  if (rejected) return rejected;
  return execute(call);
}
