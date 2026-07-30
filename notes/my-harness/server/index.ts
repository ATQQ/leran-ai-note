/**
 * my-harness HTTP 演示 Server
 *
 * 职责：
 * 1. 托管 web/ 静态资源（每阶段独立目录）
 * 2. POST /api/run：调用 kernel，以 SSE 推送 RunEvent
 * 3. 读取 .env 中的模型密钥（绝不下发到浏览器）
 * 4. 将脱敏后的 Trace 写入 traces/
 * 5. M2：透传 maxSteps / timeoutMs / stopOnToolError；本地校验演示；取消时仍落盘 Trace
 *
 * 启动：npm run demo → http://127.0.0.1:8787/web/index/index.html
 */
import http from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import {
  buildOpenAIRequestInspect,
  createOpenAIAdapter,
  openaiToolsSchemaForTrace,
} from "../src/adapters/openai.ts";
import {
  buildSeedHistory,
  createAssembleContext,
} from "../src/kernel/context.ts";
import { runAgent } from "../src/kernel/loop.ts";
import {
  discoverSkills,
  executeLoadSkill,
  formatSkillCatalog,
  LOAD_SKILL_TOOL,
  planSkillInjection,
  type SkillDef,
} from "../src/kernel/skills.ts";
import { MOCK_TOOLS, executeMockTool } from "../src/kernel/tools.ts";
import { executeToolWithValidation } from "../src/kernel/validate.ts";
import { loadEnv, packageRootFrom } from "../src/load-env.ts";
import { TraceRecorder } from "../src/trace.ts";
import type { RunEvent, ToolCall, ToolDef, UnifiedMessage } from "../src/types.ts";

const ROOT = packageRootFrom(import.meta.url);
loadEnv(ROOT);

const PORT = Number(process.env.PORT || 8787);
const BASE = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(
  /\/$/,
  "",
);
const KEY = process.env.OPENAI_API_KEY || "";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/** 启动时扫描 skills/；热更可用后续 /api/skills/reload，M4 先静态发现 */
const SKILLS_ROOT = join(ROOT, "skills");
let DISCOVERED_SKILLS: SkillDef[] = discoverSkills(SKILLS_ROOT);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

/** 请求体：M2 约束 + M3 Context 策略；localGuard 用于不经模型的确定性校验演示 */
type RunBody = {
  prompt?: string;
  systemPrompt?: string;
  maxSteps?: number;
  timeoutMs?: number;
  stopOnToolError?: boolean;
  /**
   * 本地守卫演示（不调模型，专测 V3）：
   * - unknown_tool：伪造未知工具名
   * - bad_args：伪造不合 schema 的参数
   */
  localGuard?: "unknown_tool" | "bad_args";
  /** M3：Context 裁剪策略 */
  contextStrategy?: "identity" | "recent_n" | "char_budget";
  /** recent_n：保留最近几条非 system（默认 6） */
  recentN?: number;
  /** char_budget：发给模型的粗略字符上限（默认 2000） */
  maxChars?: number;
  /**
   * M3/V5：在当前问题前灌入多少轮「user+assistant」填充历史。
   * 仅占位文本，不含密钥与工具实现。
   * 若同时传了 history，则以 history 为准（忽略 seedPairs）。
   */
  seedPairs?: number;
  /**
   * M3：页面构造的历史消息（不含 system / 当前 prompt）。
   * 服务端会做角色与字段白名单清洗。
   */
  history?: unknown[];
  /** M4：是否把 SKILL 目录（name+description）写入 system */
  skillCatalog?: boolean;
  /** M4：要注入全文的 skill name 列表（手动） */
  injectSkills?: string[];
  /**
   * M4：未手动指定时的策略
   * - off / match / model：见 skills.ts
   * - agent：Pi 风格，目录 + load_skill 工具，模型按需加载全文
   */
  skillAuto?: "off" | "match" | "model" | "agent";
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(body));
}

/** 写一条 SSE 帧：event 名 + JSON data（注意末尾空行） */
function writeSse(res: http.ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * 静态文件服务。
 * - `/` → 索引页
 * - 若 URL 指向目录，回落到该目录下的 index.html（避免 EISDIR 崩溃）
 * - 禁止 `..` 越出包根
 */
function serveStatic(urlPath: string, res: http.ServerResponse): boolean {
  let rel = urlPath === "/" ? "/web/index/index.html" : urlPath;
  if (rel.includes("..")) {
    sendJson(res, 400, { error: "invalid path" });
    return true;
  }
  let filePath = resolve(ROOT, rel.replace(/^\//, ""));
  if (!filePath.startsWith(ROOT) || !existsSync(filePath)) return false;
  const st = statSync(filePath);
  if (st.isDirectory()) {
    const indexPath = join(filePath, "index.html");
    if (!existsSync(indexPath) || !statSync(indexPath).isFile()) return false;
    filePath = indexPath;
  } else if (!st.isFile()) {
    return false;
  }
  const mime = MIME[extname(filePath)] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": mime });
  res.end(readFileSync(filePath));
  return true;
}

/** 带 schema 校验的执行入口；可挂上 load_skill（Pi 风格） */
function createExecuteGuarded(tools: ToolDef[], skills: SkillDef[]) {
  return async (call: ToolCall) => {
    if (call.name === "load_skill") {
      return executeToolWithValidation(call, tools, async (c) =>
        executeLoadSkill(c, skills),
      );
    }
    return executeToolWithValidation(call, tools, executeMockTool);
  };
}

/**
 * 清洗前端构造的历史：只保留统一消息白名单字段，拒绝 system（system 由服务端固定）。
 * 避免把任意 JSON / 敏感字段直接灌进 Context。
 */
function sanitizeHistory(raw: unknown[]): UnifiedMessage[] {
  const allowed = new Set(["user", "assistant", "tool"]);
  const out: UnifiedMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    const role = String(m.role ?? "");
    if (!allowed.has(role)) continue;
    const msg: UnifiedMessage = {
      role: role as UnifiedMessage["role"],
      content: typeof m.content === "string" ? m.content : m.content === null ? null : String(m.content ?? ""),
    };
    if (typeof m.name === "string") msg.name = m.name;
    if (typeof m.toolCallId === "string") msg.toolCallId = m.toolCallId;
    if (Array.isArray(m.toolCalls)) {
      msg.toolCalls = m.toolCalls
        .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
        .map((c, i) => ({
          id: typeof c.id === "string" ? c.id : `hist_${i}`,
          name: typeof c.name === "string" ? c.name : "unknown",
          arguments:
            c.arguments && typeof c.arguments === "object" && !Array.isArray(c.arguments)
              ? (c.arguments as Record<string, unknown>)
              : {},
        }));
    }
    out.push(msg);
  }
  return out.slice(0, 80); // 防止一次灌爆
}

/**
 * 不经模型的本地校验演示：发与真实 run 同构的 SSE 事件，便于 m2 页对照 V3。
 */
async function runLocalGuardDemo(
  res: http.ServerResponse,
  kind: "unknown_tool" | "bad_args",
  stopOnToolError: boolean,
): Promise<void> {
  const trace = new TraceRecorder({
    provider: "openai",
    model: MODEL,
    baseUrl: BASE,
    toolsSchema: openaiToolsSchemaForTrace(MOCK_TOOLS),
  });

  const onEvent = (event: RunEvent) => {
    if (event.type !== "text_delta") trace.addFromEvent(event);
    writeSse(res, event.type, event);
  };

  const call: ToolCall =
    kind === "unknown_tool"
      ? { id: "demo_unknown", name: "fly_to_moon", arguments: { speed: 1 } }
      : { id: "demo_bad_args", name: "add", arguments: { a: "十二", b: true } };

  writeSse(res, "meta", {
    model: MODEL,
    adapter: "local-guard",
    localGuard: kind,
  });

  onEvent({
    type: "run_start",
    phase: "init",
    title: "本地守卫演示",
    summary: `不经模型，直接校验伪造 ToolCall（${kind}）`,
    actor: "harness",
    direction: "local",
    payload: { localGuard: kind, call, stopOnToolError },
    at: new Date().toISOString(),
  });

  onEvent({
    type: "assistant_message",
    phase: "model_response",
    title: "伪造 · 模型响应",
    summary: "注入 1 个待校验的工具调用",
    actor: "model",
    direction: "in",
    payload: { content: null, toolCalls: [call], reasoning: null },
    note: "仅用于 V3 确定性演示，非真实模型输出",
    at: new Date().toISOString(),
  });

  onEvent({
    type: "tool_start",
    phase: "execute_tool",
    title: `执行工具 · ${call.name}`,
    summary: `id=${call.id}`,
    actor: "tool",
    direction: "local",
    payload: { toolCallId: call.id, name: call.name, arguments: call.arguments },
    at: new Date().toISOString(),
  });

  const result = await createExecuteGuarded(MOCK_TOOLS, DISCOVERED_SKILLS)(call);
  const toolMessage = {
    role: "tool" as const,
    content: result.content,
    toolCallId: result.toolCallId,
    name: result.name,
  };

  onEvent({
    type: "tool_end",
    phase: "append_tool_result",
    title: `回写工具结果 · ${call.name}`,
    summary: result.isError ? "工具返回错误（已回写）" : "结果已写入 Context",
    actor: "harness",
    direction: "local",
    payload: { appended: toolMessage, isError: result.isError ?? false },
    note: result.isError ? "校验失败或执行失败；不静默吞掉" : null,
    at: new Date().toISOString(),
  });

  const stopReason =
    result.isError && stopOnToolError ? "tool_error" : result.isError ? "completed" : "completed";

  onEvent({
    type: "run_end",
    phase: "final_answer",
    title: "运行结束",
    summary: `stopReason=${stopReason}`,
    actor: "harness",
    direction: "local",
    payload: {
      finalText: null,
      stopReason,
      steps: 0,
      localGuard: kind,
      validationError: result.isError,
    },
    at: new Date().toISOString(),
  });

  trace.finish({
    finalAnswer: null,
    stopReason,
    localGuard: kind,
  });
  const path = trace.write(join(ROOT, "traces"), "openai");
  writeSse(res, "done", {
    finalText: null,
    stopReason,
    tracePath: path,
    localGuard: kind,
    toolResult: result,
  });
}

// 外层包一层 catch：单次请求异常不应打崩整个进程
const server = http.createServer((req, res) => {
  void handleRequest(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: "internal error" });
    } else {
      res.end();
    }
  });
});

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname;

  // CORS 预检（本地打开 file:// 或跨端口时可能用到）
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // 健康检查：不回传 Key，只说明是否已配置
  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      model: MODEL,
      baseUrl: BASE,
      hasKey: Boolean(KEY) && !KEY.includes("xxx"),
    });
    return;
  }

  // 供页面 Trace 回放区加载最近一次运行结果
  if (req.method === "GET" && pathname === "/api/trace/latest") {
    const p = join(ROOT, "traces", "openai-latest.json");
    if (!existsSync(p)) {
      sendJson(res, 404, { error: "no trace yet" });
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(readFileSync(p));
    return;
  }

  // M4：已发现的 SKILL 列表（不含全文，避免列表接口过大；全文在注入时进 system）
  if (req.method === "GET" && pathname === "/api/skills") {
    sendJson(res, 200, {
      root: "skills/",
      skills: DISCOVERED_SKILLS.map((s) => ({
        name: s.name,
        description: s.description,
        path: s.path,
        bodyChars: s.body.length,
      })),
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/skills/reload") {
    DISCOVERED_SKILLS = discoverSkills(SKILLS_ROOT);
    sendJson(res, 200, {
      ok: true,
      count: DISCOVERED_SKILLS.length,
      names: DISCOVERED_SKILLS.map((s) => s.name),
    });
    return;
  }

  // 主入口：流式跑一轮 Agent（或本地守卫演示）
  if (req.method === "POST" && pathname === "/api/run") {
    let body: RunBody = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw) as RunBody;
    } catch {
      sendJson(res, 400, { error: "invalid JSON body" });
      return;
    }

    const maxSteps =
      typeof body.maxSteps === "number" && body.maxSteps > 0 ? body.maxSteps : 8;
    const timeoutMs =
      typeof body.timeoutMs === "number" && body.timeoutMs > 0 ? body.timeoutMs : undefined;
    const stopOnToolError = Boolean(body.stopOnToolError);
    const contextStrategy = body.contextStrategy ?? "identity";
    const recentN =
      typeof body.recentN === "number" && body.recentN >= 0 ? body.recentN : 6;
    const maxChars =
      typeof body.maxChars === "number" && body.maxChars > 0 ? body.maxChars : 2000;
    const seedPairs =
      typeof body.seedPairs === "number" && body.seedPairs > 0 ? body.seedPairs : 0;

    // 先写 SSE 头，再边跑边推事件
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    // 本地守卫：不需要 API Key，确定性产出错误 ToolResult（V3）
    if (body.localGuard === "unknown_tool" || body.localGuard === "bad_args") {
      await runLocalGuardDemo(res, body.localGuard, stopOnToolError);
      res.end();
      return;
    }

    if (!KEY || KEY.includes("xxx")) {
      writeSse(res, "done", {
        error: "缺少 OPENAI_API_KEY。请复制 .env.example 为 .env 并填写。",
        stopReason: "error",
      });
      res.end();
      return;
    }

    // 默认固定演示 prompt（与 PLAN 回归用例一致）
    let prompt =
      "帮我查一下深圳的天气，再用工具算一下 12 加 30，最后用中文简短总结。";
    if (typeof body.prompt === "string" && body.prompt.trim()) {
      prompt = body.prompt.trim();
    }
    const baseSystem =
      typeof body.systemPrompt === "string" && body.systemPrompt.trim()
        ? body.systemPrompt.trim()
        : "你是助手。需要天气或加法时必须调用工具，不要编造工具结果。";

    const skillCatalog = Boolean(body.skillCatalog);
    const injectSkills = Array.isArray(body.injectSkills)
      ? body.injectSkills.filter((n): n is string => typeof n === "string")
      : [];
    const skillAutoRaw = body.skillAuto;
    const skillAuto: "off" | "match" | "model" | "agent" =
      skillAutoRaw === "match" ||
      skillAutoRaw === "model" ||
      skillAutoRaw === "off" ||
      skillAutoRaw === "agent"
        ? skillAutoRaw
        : "off";

    // 浏览器断开连接 → abort → loop / fetch 停止
    const ac = new AbortController();
    req.on("close", () => ac.abort());

    const adapter = createOpenAIAdapter({
      baseUrl: BASE,
      apiKey: KEY,
      model: MODEL,
    });
    // 主任务 tools 可能含 load_skill；onEvent 出站 JSON 跟同一份
    let runTools: ToolDef[] = MOCK_TOOLS;
    const trace = new TraceRecorder({
      provider: "openai",
      model: MODEL,
      baseUrl: BASE,
      toolsSchema: openaiToolsSchemaForTrace(MOCK_TOOLS),
    });

    const onEvent = (event: RunEvent) => {
      if (event.type === "llm_request" && event.payload && typeof event.payload === "object") {
        const p = event.payload as Record<string, unknown>;
        const after = p.messagesAfter;
        if (Array.isArray(after)) {
          p.openaiRequest = buildOpenAIRequestInspect({
            model: MODEL,
            messages: after as UnifiedMessage[],
            tools: runTools,
          });
        }
      }
      if (event.type !== "text_delta") {
        trace.addFromEvent(event);
      }
      writeSse(res, event.type, event);
    };

    // M4：若选 model 自动分析，先用「仅目录」问模型要哪些 skill（无 tools）
    let preselected: string[] | undefined;
    if (
      skillAuto === "model" &&
      !injectSkills.length &&
      !/\/skill(?::|\s+)/.test(prompt) &&
      DISCOVERED_SKILLS.length
    ) {
      const catalogText = formatSkillCatalog(DISCOVERED_SKILLS);
      const classifyMessages: UnifiedMessage[] = [
        {
          role: "system",
          content:
            "你是 SKILL 路由器。只输出一行 JSON：{\"skills\":[\"name\",...]}。" +
            "从目录中选与用户任务相关的 skill name；都不相关则 {\"skills\":[]}。" +
            "不要输出其它文字，不要调用工具。",
        },
        {
          role: "user",
          content: catalogText + "\n\n用户任务：\n" + prompt,
        },
      ];
      onEvent({
        type: "skill_inject",
        phase: "skill",
        title: "自动分析 · 请求模型分类",
        summary: "仅带目录、无 tools；解析 JSON 后再二次注入全文",
        actor: "harness",
        direction: "out",
        payload: {
          mode: "model_classify",
          messages: classifyMessages,
          openaiRequest: buildOpenAIRequestInspect({
            model: MODEL,
            messages: classifyMessages,
            tools: [],
          }),
        },
        note: "渐进披露：先目录，后全文",
        at: new Date().toISOString(),
      });
      try {
        const classified = await adapter.stream({
          messages: classifyMessages,
          tools: [],
          signal: ac.signal,
        });
        const raw = classified.content || "";
        onEvent({
          type: "skill_inject",
          phase: "skill",
          title: "自动分析 · 模型分类结果",
          summary: raw.slice(0, 200) || "(空)",
          actor: "model",
          direction: "in",
          payload: { content: raw },
          at: new Date().toISOString(),
        });
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]) as { skills?: unknown };
            if (Array.isArray(parsed.skills)) {
              preselected = parsed.skills.filter(
                (n): n is string => typeof n === "string",
              );
            }
          } catch {
            preselected = [];
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onEvent({
          type: "error",
          phase: "skill",
          title: "SKILL 模型分类失败",
          summary: message,
          actor: "harness",
          direction: "local",
          payload: { error: message },
          at: new Date().toISOString(),
        });
        // 回退：不注入全文，继续跑主任务
        preselected = [];
      }
    }

    const planned = planSkillInjection({
      baseSystem,
      skills: DISCOVERED_SKILLS,
      prompt,
      skillCatalog,
      injectSkills,
      skillAuto,
      preselected,
    });
    const skillAsm = planned.result;
    const systemPrompt = skillAsm.systemContent;

    // Pi 风格：把 load_skill 挂进本轮 tools
    runTools = planned.enableLoadSkillTool
      ? [...MOCK_TOOLS, LOAD_SKILL_TOOL]
      : MOCK_TOOLS;
    const executeTool = createExecuteGuarded(runTools, DISCOVERED_SKILLS);
    // Trace 记录实际发给模型的 tools（含或不含 load_skill）
    trace.toolsSchema = openaiToolsSchemaForTrace(runTools);

    for (const ph of planned.phases) {
      onEvent({
        type: "skill_inject",
        phase: "skill",
        title: ph.title,
        summary: ph.summary,
        actor: "harness",
        direction: "local",
        payload: ph.payload,
        note: "SKILL 渐进披露阶段",
        at: new Date().toISOString(),
      });
    }

    // M3：历史来源优先页面构造的 history；否则 seedPairs 填充
    const historyFromClient = Array.isArray(body.history)
      ? sanitizeHistory(body.history)
      : null;
    const historyMessages =
      historyFromClient ?? buildSeedHistory(seedPairs);

    const initialMessages: UnifiedMessage[] = [
      { role: "system", content: systemPrompt },
      ...historyMessages,
      { role: "user", content: prompt },
    ];
    const assembleContext = createAssembleContext({
      strategy: contextStrategy,
      recentN,
      maxChars,
    });

    writeSse(res, "meta", {
      model: MODEL,
      adapter: "openai",
      maxSteps,
      timeoutMs: timeoutMs ?? null,
      stopOnToolError,
      contextStrategy,
      recentN,
      maxChars,
      seedPairs: historyFromClient ? 0 : seedPairs,
      historySource: historyFromClient ? "client" : seedPairs > 0 ? "seed" : "none",
      historyCount: historyMessages.length,
      initialMessageCount: initialMessages.length,
      skillCatalog,
      skillAuto,
      injectSkills: skillAsm.injectedNames,
      catalogNames: skillAsm.catalogNames,
      injectSource: planned.injectSource,
      loadSkillTool: planned.enableLoadSkillTool,
    });

    try {
      const result = await runAgent({
        prompt,
        messages: initialMessages,
        tools: runTools,
        executeTool,
        adapter,
        maxSteps,
        timeoutMs,
        stopOnToolError,
        assembleContext,
        signal: ac.signal,
        onEvent,
      });
      trace.finish({
        finalAnswer: result.finalText,
        stopReason: result.stopReason,
        contextStrategy,
        historySource: historyFromClient ? "client" : seedPairs > 0 ? "seed" : "none",
        historyCount: historyMessages.length,
        skillCatalog,
        injectedSkills: skillAsm.injectedNames,
        catalogNames: skillAsm.catalogNames,
        injectSource: planned.injectSource,
        loadSkillTool: planned.enableLoadSkillTool,
      });
      const path = trace.write(join(ROOT, "traces"), "openai");
      writeSse(res, "done", {
        finalText: result.finalText,
        stopReason: result.stopReason,
        tracePath: path,
        injectedSkills: skillAsm.injectedNames,
        injectSource: planned.injectSource,
        loadSkillTool: planned.enableLoadSkillTool,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const name = err instanceof Error ? err.name : "";
      // 取消 / 超时：仍落盘 Trace，便于 V4b 审计终止原因
      if (name === "AbortError" || ac.signal.aborted) {
        const stopReason = "aborted";
        onEvent({
          type: "run_end",
          phase: "final_answer",
          title: "运行结束",
          summary: `stopReason=${stopReason}`,
          actor: "harness",
          direction: "local",
          payload: { finalText: null, stopReason },
          at: new Date().toISOString(),
        });
        trace.finish({ finalAnswer: null, stopReason });
        try {
          const path = trace.write(join(ROOT, "traces"), "openai");
          writeSse(res, "done", { stopReason, tracePath: path });
        } catch {
          writeSse(res, "done", { stopReason });
        }
      } else {
        onEvent({
          type: "error",
          phase: "error",
          title: "运行失败",
          summary: message,
          actor: "harness",
          direction: "local",
          payload: { error: message },
          at: new Date().toISOString(),
        });
        trace.finish({ error: message, stopReason: "error" });
        try {
          trace.write(join(ROOT, "traces"), "openai");
        } catch {
          /* 写盘失败不影响响应结束 */
        }
        writeSse(res, "done", { error: message, stopReason: "error" });
      }
    }

    res.end();
    return;
  }

  if (req.method === "GET" && serveStatic(pathname, res)) return;

  sendJson(res, 404, { error: "Not Found" });
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`my-harness demo: http://127.0.0.1:${PORT}/web/index/index.html`);
  console.log(`health: http://127.0.0.1:${PORT}/api/health`);
  console.log(`model: ${MODEL} @ ${BASE}`);
  console.log(
    `skills: ${DISCOVERED_SKILLS.length} → ${DISCOVERED_SKILLS.map((s) => s.name).join(", ") || "(none)"}`,
  );
});
