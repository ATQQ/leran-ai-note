/**
 * M7.1 工具风险策略
 *
 * 高风险工具：执行前可要求前端确认（confirmTool）。
 * 名单按工具名匹配（本地 mock + MCP 原名）。
 */
import type { ToolCall, ToolDef } from "../types.ts";

/** 默认高风险：写盘 / 演示「清库」类 */
export const DEFAULT_HIGH_RISK_TOOLS = new Set([
  "wipe_demo",
  "write_file",
]);

export function isHighRiskTool(
  name: string,
  extra?: Iterable<string>,
): boolean {
  if (DEFAULT_HIGH_RISK_TOOLS.has(name)) return true;
  if (extra) {
    for (const n of extra) {
      if (n === name) return true;
    }
  }
  return false;
}

/** 给 ToolDef 打上 risk 标记（仅元数据，不影响 schema） */
export function annotateToolRisk(tools: ToolDef[]): ToolDef[] {
  return tools.map((t) =>
    isHighRiskTool(t.name) ? { ...t, risk: "high" as const } : t,
  );
}

export function needsConfirm(
  call: ToolCall,
  requireConfirm: boolean,
  extraHighRisk?: Iterable<string>,
): boolean {
  return requireConfirm && isHighRiskTool(call.name, extraHighRisk);
}
