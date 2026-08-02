/**
 * M7.3 流式 JSON 部分解析（仅展示，不驱动执行）
 *
 * 安全边界：Harness 仍只在流结束后用完整 JSON.parse 的 ToolCall 执行。
 * 本模块尝试从「尚未闭合」的 arguments 字符串里猜出已出现的键值，供 UI 预览。
 */

export type PartialJsonResult = {
  /** 尽力解析出的对象；失败则为 null */
  partial: Record<string, unknown> | null;
  /** 是否已是合法完整 JSON 对象 */
  complete: boolean;
  note: string;
};

/**
 * 尝试把未完成的 JSON 对象字符串补全后 parse。
 * 仅处理 `{...}` 形态；数组/标量不作为工具参数预览。
 */
export function tryParsePartialJson(raw: string): PartialJsonResult {
  const s = String(raw ?? "").trim();
  if (!s) {
    return { partial: null, complete: false, note: "empty" };
  }

  try {
    const v = JSON.parse(s);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return {
        partial: v as Record<string, unknown>,
        complete: true,
        note: "complete",
      };
    }
    return { partial: null, complete: true, note: "complete_non_object" };
  } catch {
    /* fall through to repair */
  }

  // 启发式补全：补齐未闭合的引号与括号
  let repaired = s;
  if (!repaired.startsWith("{")) {
    return { partial: null, complete: false, note: "not_object_prefix" };
  }

  const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2 === 1) repaired += '"';

  // 去掉尾部悬挂逗号
  repaired = repaired.replace(/,\s*$/, "");

  let openCurly = 0;
  let openSquare = 0;
  let inString = false;
  let escape = false;
  for (const ch of repaired) {
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") openCurly += 1;
    else if (ch === "}") openCurly -= 1;
    else if (ch === "[") openSquare += 1;
    else if (ch === "]") openSquare -= 1;
  }
  while (openSquare > 0) {
    repaired += "]";
    openSquare -= 1;
  }
  while (openCurly > 0) {
    repaired += "}";
    openCurly -= 1;
  }

  try {
    const v = JSON.parse(repaired);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return {
        partial: v as Record<string, unknown>,
        complete: false,
        note: "partial_repaired",
      };
    }
  } catch {
    /* ignore */
  }
  return { partial: null, complete: false, note: "unparseable" };
}
