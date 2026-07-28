/**
 * 零依赖读取 .env
 *
 * 格式：KEY=VALUE；忽略空行与 # 注释；已存在的 process.env 不被覆盖。
 * 密钥只应出现在 Server 侧，切勿把 .env 提交进版本库。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 从指定目录加载 env 文件到 process.env。
 * @param fromDir 通常为包根目录（含 .env 的目录）
 */
export function loadEnv(fromDir: string, filename = ".env"): void {
  const path = resolve(fromDir, filename);
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i <= 0) continue;
    const key = trimmed.slice(0, i).trim();
    let val = trimmed.slice(i + 1).trim();
    // 去掉成对引号
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

/**
 * 由当前模块的 import.meta.url 推到上一级目录（包根）。
 * server/index.ts 用此得到 notes/my-harness/。
 */
export function packageRootFrom(importMetaUrl: string): string {
  return resolve(dirname(fileURLToPath(importMetaUrl)), "..");
}
