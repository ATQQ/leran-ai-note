/**
 * 按 backend 创建 Host Client（raw | sdk）
 */
import type { McpBackend, McpHostClient } from "./host.ts";
import { McpSdkClient } from "./sdk-client.ts";
import { McpStdioClient } from "./stdio-client.ts";

export function createMcpHostClient(backend: McpBackend): McpHostClient {
  return backend === "sdk" ? new McpSdkClient() : new McpStdioClient();
}

export function parseMcpBackend(raw: unknown): McpBackend {
  return raw === "sdk" ? "sdk" : "raw";
}
