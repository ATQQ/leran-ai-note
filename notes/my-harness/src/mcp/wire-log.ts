/**
 * JSON-RPC 线缆日志（教学习）：记录 Client↔Server 每一行帧。
 * raw = 真实 stdout/stdin 行；sdk = 按同样形状复原的等价帧（SDK 内部不暴露原文）。
 */
export type McpWireFrame = {
  at: string;
  /** out = Host→Server；in = Server→Host */
  dir: "out" | "in";
  /** wire=真实管道；logical=SDK 复原 */
  source: "wire" | "logical";
  /** 单行 JSON 文本（可能截断） */
  line: string;
};

const MAX = 80;

export class McpWireLog {
  private frames: McpWireFrame[] = [];

  clear(): void {
    this.frames = [];
  }

  push(dir: "out" | "in", line: string, source: "wire" | "logical" = "wire"): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    this.frames.push({
      at: new Date().toISOString(),
      dir,
      source,
      line: trimmed.length > 4000 ? trimmed.slice(0, 4000) + "…(truncated)" : trimmed,
    });
    if (this.frames.length > MAX) {
      this.frames = this.frames.slice(-MAX);
    }
  }

  /** 写入请求帧（带 jsonrpc 包装） */
  pushOut(
    obj: Record<string, unknown>,
    source: "wire" | "logical" = "wire",
  ): void {
    this.push("out", JSON.stringify(obj), source);
  }

  pushIn(
    obj: Record<string, unknown>,
    source: "wire" | "logical" = "wire",
  ): void {
    this.push("in", JSON.stringify(obj), source);
  }

  snapshot(): McpWireFrame[] {
    return [...this.frames];
  }
}
