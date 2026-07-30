/**
 * M4 演示页：自动二次注入 + 步骤/JSON 回溯
 */
import { runSse } from "../shared/shared.js";
import {
  createStepsView,
  renderStepDetail,
  renderAutoHelp,
} from "./steps.js";

const skillListEl = document.getElementById("skillList");
const skillStatus = document.getElementById("skillStatus");
const skillCatalogEl = document.getElementById("skillCatalog");
const skillAutoEl = document.getElementById("skillAuto");
const strategyHelp = document.getElementById("strategyHelp");
const promptEl = document.getElementById("prompt");
const streamEl = document.getElementById("stream");
const eventsEl = document.getElementById("events");
const statusEl = document.getElementById("status");
const runBtn = document.getElementById("run");
const stopBtn = document.getElementById("stop");
const reloadBtn = document.getElementById("reloadSkills");

const detailEls = {
  detailPill: document.getElementById("detailPill"),
  detailBody: document.getElementById("detailBody"),
  jsonUnified: document.getElementById("jsonUnified"),
  jsonOpenAI: document.getElementById("jsonOpenAI"),
};

/** @type {Array<{name:string,description:string,path:string,bodyChars:number}>} */
let skills = [];
let abortController = null;

const PROMPTS = {
  v6: "帮我查一下深圳的天气，再用工具算一下 12 加 30，最后用中文简短总结。",
  weather: "深圳今天天气怎么样？给我一个规范汇报。",
  cmd: "/skill:weather-brief 查深圳天气并按规程总结。",
};

const stepsView = createStepsView(document.getElementById("steps"), (step) => {
  renderStepDetail(detailEls, step);
});

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = "pill" + (cls ? " " + cls : "");
}

function appendEvent(line) {
  eventsEl.textContent += line + "\n";
  eventsEl.scrollTop = eventsEl.scrollHeight;
}

function selectedInjectNames() {
  return [...skillListEl.querySelectorAll("input[data-skill]:checked")].map(
    (el) => el.getAttribute("data-skill"),
  );
}

function refreshHelp() {
  renderAutoHelp(strategyHelp, skillAutoEl.value);
}

function renderSkillList() {
  skillListEl.replaceChildren();
  for (const s of skills) {
    const card = document.createElement("div");
    card.className = "skill-card";
    card.innerHTML = `
      <label>
        <input type="checkbox" data-skill="${s.name}" />
        <div>
          <div class="skill-name">${s.name}</div>
          <p class="skill-desc">${s.description}</p>
        </div>
      </label>
    `;
    skillListEl.append(card);
  }
}

async function loadSkills() {
  skillStatus.textContent = "loading";
  const res = await fetch("/api/skills");
  if (!res.ok) throw new Error("skills api failed");
  const data = await res.json();
  skills = data.skills || [];
  skillStatus.textContent = skills.length + " skills";
  skillStatus.className = "pill ok";
  renderSkillList();
}

reloadBtn.onclick = async () => {
  await fetch("/api/skills/reload", { method: "POST" });
  await loadSkills();
  appendEvent("[skills] reloaded");
};

skillAutoEl.onchange = refreshHelp;
refreshHelp();

document.body.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-prompt]");
  if (!btn) return;
  promptEl.value = PROMPTS[btn.getAttribute("data-prompt")] || promptEl.value;
});

stopBtn.onclick = () => abortController?.abort();

runBtn.onclick = async () => {
  abortController = new AbortController();
  runBtn.disabled = true;
  stopBtn.disabled = false;
  streamEl.textContent = "";
  eventsEl.textContent = "";
  stepsView.clear();
  renderStepDetail(detailEls, null);
  setStatus("running");

  const injectSkills = selectedInjectNames();
  const body = {
    prompt: promptEl.value,
    maxSteps: 8,
    contextStrategy: "identity",
    skillCatalog: skillCatalogEl.checked,
    injectSkills,
    skillAuto: skillAutoEl.value,
  };

  appendEvent(
    `[run] catalog=${body.skillCatalog} auto=${body.skillAuto} manual=[${injectSkills.join(",") || "无"}]`,
  );

  try {
    await runSse("/api/run", {
      body,
      signal: abortController.signal,
      onEvent: ({ event, data }) => {
        if (
          event === "meta" ||
          event === "skill_inject" ||
          event === "run_start" ||
          event === "llm_request" ||
          event === "assistant_message" ||
          event === "tool_start" ||
          event === "tool_end" ||
          event === "run_end" ||
          event === "error" ||
          event === "stream_detail" ||
          event === "done"
        ) {
          if (event === "meta") {
            stepsView.append("meta", {
              title: "连接元信息",
              summary:
                `auto=${data.skillAuto} · inject=[${(data.injectSkills || []).join(",") || "无"}] · source=${data.injectSource || "?"}`,
              phase: "meta",
              payload: data,
            });
            appendEvent(`[meta] ${data.injectSource || ""} inject=${(data.injectSkills || []).join(",")}`);
            return;
          }
          if (event === "done") {
            stepsView.append("done", {
              title: "SSE done",
              summary: `stop=${data.stopReason} inject=${(data.injectedSkills || []).join(",") || "无"}`,
              phase: "done",
              payload: data,
            });
            appendEvent(`[done] ${data.stopReason}`);
            setStatus(data.stopReason || "done", data.error ? "err" : "ok");
            return;
          }
          stepsView.append(event, data);
        }

        if (event === "text_delta") {
          streamEl.textContent += data?.payload?.delta || data?.summary || "";
          streamEl.scrollTop = streamEl.scrollHeight;
          return;
        }

        if (event === "skill_inject") {
          appendEvent(`[skill] ${data.title}: ${data.summary}`);
          return;
        }

        if (event === "llm_request") {
          appendEvent(`[llm] ${data.summary}`);
          return;
        }

        if (event === "assistant_message" || event === "tool_start" || event === "tool_end") {
          appendEvent(`[${event}] ${data.summary || data.title}`);
        }
      },
    });
  } catch (err) {
    if (err?.name !== "AbortError") {
      appendEvent(String(err));
      setStatus("failed", "err");
    } else {
      setStatus("aborted", "err");
    }
  } finally {
    runBtn.disabled = false;
    stopBtn.disabled = true;
  }
};

loadSkills().catch((e) => {
  skillStatus.textContent = "error";
  skillStatus.className = "pill err";
  appendEvent(String(e));
});
