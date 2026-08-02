/**
 * M5：多 MCP Server 注册表 + Host raw|sdk + 直连路由 + Loop 步骤
 */
import { runSse } from "../shared/shared.js";
import { createStepsView, renderStepDetail } from "./steps.js";

const mcpPill = document.getElementById("mcpPill");
const mcpMeta = document.getElementById("mcpMeta");
const mcpServerList = document.getElementById("mcpServerList");
const mcpBackendEl = document.getElementById("mcpBackend");
const flowCompare = document.getElementById("flowCompare");
const wireLogEl = document.getElementById("wireLog");
const wirePill = document.getElementById("wirePill");
const routeTableEl = document.getElementById("routeTable");
const toolList = document.getElementById("toolList");
const directTool = document.getElementById("directTool");
const directArgs = document.getElementById("directArgs");
const directResult = document.getElementById("directResult");
const useMcpEl = document.getElementById("useMcp");
const promptEl = document.getElementById("prompt");
const streamEl = document.getElementById("stream");
const eventsEl = document.getElementById("events");
const statusEl = document.getElementById("status");
const runBtn = document.getElementById("run");
const stopBtn = document.getElementById("stop");

const detailEls = {
  detailPill: document.getElementById("detailPill"),
  detailBody: document.getElementById("detailBody"),
  jsonUnified: document.getElementById("jsonUnified"),
  jsonOpenAI: document.getElementById("jsonOpenAI"),
};

const stepsView = createStepsView(document.getElementById("steps"), (step) => {
  renderStepDetail(detailEls, step);
});

let abortController = null;
/** @type {object|null} */
let lastBackends = null;
/** @type {string[]} */
let selectedServers = ["demo"];

const PROMPTS = {
  v7: "用 echo 回显「MCP桥接成功」，再用 add 计算 12 加 30，最后用中文一句话总结。",
  add_only: "请只用 add 计算 100 加 23，并复述工具返回原文。",
  fs: "先 list_files，再 read_file 读 hello.txt，最后 write_file 写 notes/from-agent.txt，内容为「MCP fs 验证通过」。",
  both: "先用 add 算 7+8，再用 write_file 把结果写入 notes/sum.txt。",
  remote:
    "先用 ping 回显「remote ok」，再用 remember 存 key=city value=Shanghai，然后 recall city，最后 session_info，用中文说明这证明了会话有状态。",
};

const DIRECT_PRESETS = {
  echo: { tool: "echo", args: { text: "hello MCP" } },
  add: { tool: "add", args: { a: 12, b: 30 } },
  list: { tool: "list_files", args: {} },
  read: { tool: "read_file", args: { path: "hello.txt" } },
  write: {
    tool: "write_file",
    args: { path: "notes/demo.txt", content: "written via MCP direct call\n" },
  },
  ping: { tool: "ping", args: { text: "hello remote" } },
  remember: { tool: "remember", args: { key: "city", value: "Shanghai" } },
  recall: { tool: "recall", args: { key: "city" } },
  session: { tool: "session_info", args: {} },
};

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = "pill" + (cls ? " " + cls : "");
}

function appendEvent(line) {
  eventsEl.textContent += line + "\n";
  eventsEl.scrollTop = eventsEl.scrollHeight;
}

function selectedServerIds() {
  return [...mcpServerList.querySelectorAll("input[data-server]:checked")].map(
    (el) => el.getAttribute("data-server"),
  );
}

function renderFlow(backends, active) {
  if (!backends) {
    flowCompare.replaceChildren();
    return;
  }
  lastBackends = backends;
  flowCompare.replaceChildren();
  for (const key of ["raw", "sdk", "http"]) {
    const info = backends[key];
    if (!info) continue;
    const card = document.createElement("div");
    const isActive =
      key === "http"
        ? selectedServerIds().includes("remote")
        : key === active;
    card.className = "flow-card" + (isActive ? " active" : "");
    const steps = (info.steps || []).map((s) => `<li>${s}</li>`).join("");
    card.innerHTML =
      `<h4>${key} · ${info.label || ""}</h4>` +
      `<ol>${steps}</ol>` +
      `<div class="file">${info.file || ""}${info.package ? " · " + info.package : ""}${info.note ? " · " + info.note : ""}</div>`;
    flowCompare.append(card);
  }
}

function renderWireLog(frames) {
  const list = Array.isArray(frames) ? frames : [];
  wirePill.textContent = list.length ? list.length + " frames" : "empty";
  wirePill.className = "pill" + (list.length ? " ok" : "");
  if (!list.length) {
    wireLogEl.textContent = "（连接或调用后显示 → / ← 帧）";
    return;
  }
  wireLogEl.textContent = list
    .map((f) => {
      const arrow = f.dir === "out" ? "→ out" : "← in ";
      const src = f.source === "wire" ? "wire" : "logical";
      const sid = f.serverId ? f.serverId + " " : "";
      let pretty = f.line;
      try {
        pretty = JSON.stringify(JSON.parse(f.line), null, 2);
      } catch {
        /* keep */
      }
      return `${arrow} [${sid}${src}] ${f.at}\n${pretty}`;
    })
    .join("\n\n");
  wireLogEl.scrollTop = wireLogEl.scrollHeight;
}

function renderRouteTable(tools, conflicts) {
  const list = Array.isArray(tools) ? tools : [];
  if (!list.length) {
    routeTableEl.textContent = "（无已连接工具；先勾选 Server 并连接）";
    return;
  }
  const lines = list.map((t) => {
    const sid = t.mcpServerId || "?";
    return `${t.name}  →  Client[${sid}].callTool("${t.name}")`;
  });
  const skipped = Array.isArray(conflicts) ? conflicts : [];
  if (skipped.length) {
    lines.push("", "# conflicts (first-wins, skipped):");
    for (const c of skipped) {
      lines.push(
        `# ${c.name}: keep ${c.winnerServerId}, skip ${c.skippedServerId}`,
      );
    }
  }
  routeTableEl.textContent = lines.join("\n");
}

function renderServerChecks(servers, connectedIds) {
  const connected = new Set(connectedIds || []);
  const prev = new Set(selectedServerIds());
  mcpServerList.replaceChildren();
  for (const s of servers || []) {
    const row = document.createElement("label");
    row.className = "server-check";
    const checked =
      prev.has(s.id) || (!prev.size && (connected.has(s.id) || s.id === "demo"));
    const kind = s.transport === "http" ? "http" : "stdio";
    const extra =
      kind === "http"
        ? s.url || ""
        : (s.toolsHint || []).join("/") || s.path || "";
    row.innerHTML = `
      <input type="checkbox" data-server="${s.id}" ${checked ? "checked" : ""} ${s.exists ? "" : "disabled"} />
      <span>
        <strong>${s.id}</strong>
        <span class="pill">${kind}</span>
        ${s.connected ? '<span class="pill ok">up</span>' : '<span class="pill">down</span>'}
        ${s.sessionId ? `<span class="pill ok">sid:${String(s.sessionId).slice(0, 8)}</span>` : ""}
        <span class="muted">${s.label || ""} · ${extra}</span>
      </span>
    `;
    mcpServerList.append(row);
  }
}

function renderStatus(data) {
  const connected = Array.isArray(data.connected) ? data.connected : [];
  mcpPill.textContent =
    (connected.length ? "connected×" + connected.length : "disconnected") +
    " · " +
    (mcpBackendEl.value || "raw");
  mcpPill.className = "pill " + (connected.length ? "ok" : "warn");
  mcpMeta.textContent =
    "policy=" +
    (data.conflictPolicy || "first-wins") +
    " · connected=[" +
    connected.join(",") +
    "]" +
    (Array.isArray(data.conflicts) && data.conflicts.length
      ? " · conflicts=" + data.conflicts.length
      : "");

  renderFlow(data.backends || lastBackends, mcpBackendEl.value);
  renderServerChecks(data.servers, connected);
  renderWireLog(data.wireLog);
  renderRouteTable(data.tools, data.conflicts);

  const tools = Array.isArray(data.tools) ? data.tools : [];
  toolList.replaceChildren();
  if (!tools.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "尚无工具。勾选 Server 连接后会出现 echo / add / read_file 等原名。";
    toolList.append(empty);
    return;
  }

  directTool.replaceChildren();
  for (const t of tools) {
    const opt = document.createElement("option");
    opt.value = t.name;
    opt.textContent = t.name;
    directTool.append(opt);

    const card = document.createElement("div");
    card.className = "tool-card";
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(t.parameters ?? {}, null, 2);
    const sid = t.mcpServerId ? ` · ${t.mcpServerId}` : "";
    card.innerHTML =
      `<div class="name">${t.name}${sid}</div>` +
      `<p class="desc">${t.description || ""}</p>`;
    card.append(pre);
    toolList.append(card);
  }
}

async function refreshStatus() {
  const res = await fetch("/api/mcp/status");
  const data = await res.json();
  renderStatus(data);
  return data;
}

document.getElementById("btnRefresh").onclick = () => refreshStatus();

mcpBackendEl.onchange = () => {
  if (lastBackends) renderFlow(lastBackends, mcpBackendEl.value);
};

document.getElementById("btnConnect").onclick = async () => {
  const servers = selectedServerIds();
  if (!servers.length) {
    setStatus("请至少勾选一个 Server", "err");
    return;
  }
  setStatus("connecting…");
  const res = await fetch("/api/mcp/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      backend: mcpBackendEl.value,
      servers,
    }),
  });
  const data = await res.json();
  renderStatus(data.status || data);
  setStatus(
    data.ok
      ? "connected · " + (data.connected || []).join(",")
      : "partial/fail · " + JSON.stringify(data.failed || data.error),
    data.ok ? "ok" : "warn",
  );
  appendEvent(
    "[mcp] connect servers=" +
      JSON.stringify(servers) +
      " → " +
      JSON.stringify(data.connected || []),
  );
};

document.getElementById("btnDisconnect").onclick = async () => {
  const servers = selectedServerIds();
  // 勾选了则只断勾选的；否则全断
  if (servers.length === 1) {
    await fetch("/api/mcp/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ server: servers[0] }),
    });
  } else if (servers.length > 1) {
    for (const id of servers) {
      await fetch("/api/mcp/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ server: id }),
      });
    }
  } else {
    await fetch("/api/mcp/disconnect", { method: "POST" });
  }
  await refreshStatus();
  setStatus("disconnected", "warn");
  appendEvent("[mcp] disconnected");
};

document.querySelectorAll("[data-direct]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const kind = btn.getAttribute("data-direct");
    const preset = DIRECT_PRESETS[kind];
    if (!preset) return;
    directTool.value = preset.tool;
    directArgs.value = JSON.stringify(preset.args);
  });
});

document.getElementById("btnDirect").onclick = async () => {
  let args = {};
  try {
    args = JSON.parse(directArgs.value || "{}");
  } catch {
    directResult.textContent = "arguments JSON 无效";
    return;
  }
  directResult.textContent = "calling…";
  const res = await fetch("/api/mcp/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: directTool.value, arguments: args }),
  });
  const data = await res.json();
  directResult.textContent = JSON.stringify(
    { route: data.route, result: data.result },
    null,
    2,
  );
  if (data.status) renderStatus(data.status);
  appendEvent(
    "[direct] " +
      directTool.value +
      " route=" +
      JSON.stringify(data.route) +
      " → " +
      (data.result?.isError ? "ERROR " : "ok ") +
      String(data.result?.content ?? "").slice(0, 120),
  );
};

document.querySelectorAll("[data-prompt]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.getAttribute("data-prompt");
    if (key && PROMPTS[key]) promptEl.value = PROMPTS[key];
  });
});

runBtn.onclick = async () => {
  streamEl.textContent = "";
  eventsEl.textContent = "";
  stepsView.clear();
  renderStepDetail(detailEls, null);
  setStatus("running…");
  runBtn.disabled = true;
  stopBtn.disabled = false;
  abortController = new AbortController();

  const servers = selectedServerIds();
  const systemPrompt =
    "你是助手。请用工具原名调用（如 echo、add、list_files、read_file、write_file、ping、remember、recall、session_info）。" +
    "不要编造工具结果。";

  try {
    await runSse("/api/run", {
      body: {
        prompt: promptEl.value,
        useMcp: useMcpEl.checked,
        mcpBackend: mcpBackendEl.value,
        mcpServers: servers.length ? servers : ["demo"],
        maxSteps: 10,
        systemPrompt,
      },
      signal: abortController.signal,
      onEvent: ({ event, data }) => {
        if (data && typeof data === "object" && data.type) {
          stepsView.append(event, data);
        } else if (
          [
            "mcp_bridge",
            "run_start",
            "llm_request",
            "assistant_message",
            "tool_start",
            "tool_end",
            "stream_detail",
            "run_end",
            "error",
          ].includes(event)
        ) {
          stepsView.append(event, data || { title: event });
        }

        if (event === "text_delta" && data?.payload?.delta) {
          streamEl.textContent += data.payload.delta;
        }
        if (event === "mcp_bridge") {
          appendEvent(`[mcp_bridge] ${data.summary || ""}`);
        }
        if (event === "meta") {
          appendEvent(
            `[meta] servers=${(data.mcpServers || []).join(",")} tools=${(data.tools || []).join(",")}`,
          );
        }
        if (event === "llm_request") {
          appendEvent(`[llm_request] ${data.summary || ""}`);
        }
        if (event === "tool_start") {
          appendEvent(
            `[tool_start] ${data.payload?.name} ${JSON.stringify(data.payload?.arguments ?? {})}`,
          );
        }
        if (event === "tool_end") {
          const content = data.payload?.appended?.content ?? "";
          appendEvent(
            `[tool_end] ${data.payload?.appended?.name || ""} isError=${data.payload?.isError} ${String(content).slice(0, 160)}`,
          );
        }
        if (event === "run_end") {
          appendEvent(`[run_end] ${data.summary || ""}`);
        }
        if (event === "done") {
          setStatus(
            data.stopReason || (data.error ? "error" : "done"),
            data.error ? "err" : "ok",
          );
          if (data.error) appendEvent("[done] " + data.error);
        }
        if (event === "error") {
          appendEvent(`[error] ${data.summary || ""}`);
          setStatus("error", "err");
        }
      },
    });
  } catch (err) {
    if (err?.name === "AbortError") setStatus("aborted", "warn");
    else {
      setStatus("error", "err");
      appendEvent(String(err));
    }
  } finally {
    runBtn.disabled = false;
    stopBtn.disabled = true;
    abortController = null;
    await refreshStatus();
  }
};

stopBtn.onclick = () => abortController?.abort();

refreshStatus().catch((err) => {
  mcpPill.textContent = "error";
  mcpPill.className = "pill err";
  mcpMeta.textContent = String(err);
});
