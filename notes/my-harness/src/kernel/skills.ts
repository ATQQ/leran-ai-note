/**
 * SKILL 发现与渐进披露（M4）
 *
 * 对照：
 * - 学习笔记：目录元数据常驻 + 全文按需
 * - Pi：system 放目录；模型用 read 加载 SKILL.md（本项目用 load_skill 工具同构）
 *
 * SKILL 本身是规程文档；load_skill 只是「把文档读进 Context」的通道，不是业务副作用。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { ToolCall, ToolDef, ToolResult } from "../types.ts";

/** 发现后的单个 SKILL */
export type SkillDef = {
  name: string;
  description: string;
  /** Markdown 正文（不含 frontmatter） */
  body: string;
  /** 相对 skills 根的路径，便于 Trace */
  path: string;
};

export type SkillInjection = {
  /** 是否把目录摘要写入 system */
  includeCatalog: boolean;
  /** 要注入全文的 skill name 列表 */
  injectFull: string[];
};

export type SkillAssembleResult = {
  /** 拼好的 system 文本（原 system + 可选目录 + 可选全文） */
  systemContent: string;
  /** 审计：目录里列出的 name */
  catalogNames: string[];
  /** 审计：实际注入全文的 name */
  injectedNames: string[];
  /** 人类可读说明 */
  note: string;
};

/**
 * 极简 YAML frontmatter 解析（只够 name / description）。
 * 不引入 yaml 依赖；复杂 frontmatter 可后续再加强。
 */
export function parseFrontmatter(raw: string): {
  attrs: Record<string, string>;
  body: string;
} {
  const trimmed = raw.replace(/^\uFEFF/, "");
  if (!trimmed.startsWith("---")) {
    return { attrs: {}, body: trimmed.trim() };
  }
  const end = trimmed.indexOf("\n---", 3);
  if (end < 0) {
    return { attrs: {}, body: trimmed.trim() };
  }
  const fm = trimmed.slice(3, end).trim();
  const body = trimmed.slice(end + 4).replace(/^\s*\n/, "").trim();
  const attrs: Record<string, string> = {};
  for (const line of fm.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    attrs[m[1]] = v;
  }
  return { attrs, body };
}

/** 从单个 .md 文件加载 SkillDef */
export function loadSkillFile(filePath: string, skillsRoot: string): SkillDef | null {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return null;
  if (extname(filePath).toLowerCase() !== ".md") return null;
  const raw = readFileSync(filePath, "utf8");
  const { attrs, body } = parseFrontmatter(raw);
  const fallbackName = basename(filePath, ".md");
  const name = (attrs.name || fallbackName).trim();
  if (!name) return null;
  const description = (attrs.description || "(无 description)").trim();
  const rel = filePath.startsWith(skillsRoot)
    ? filePath.slice(skillsRoot.length).replace(/^[\\/]/, "")
    : basename(filePath);
  return { name, description, body, path: rel.replace(/\\/g, "/") };
}

/**
 * 发现 skills 目录：
 * - 根下 *.md
 * - 子目录 name/SKILL.md（兼容 Agent Skills / Pi 布局）
 */
export function discoverSkills(skillsRoot: string): SkillDef[] {
  if (!existsSync(skillsRoot) || !statSync(skillsRoot).isDirectory()) {
    return [];
  }
  const out: SkillDef[] = [];
  const seen = new Set<string>();

  const push = (skill: SkillDef | null) => {
    if (!skill) return;
    if (seen.has(skill.name)) return;
    seen.add(skill.name);
    out.push(skill);
  };

  for (const ent of readdirSync(skillsRoot)) {
    const full = join(skillsRoot, ent);
    const st = statSync(full);
    if (st.isFile() && extname(ent).toLowerCase() === ".md") {
      push(loadSkillFile(full, skillsRoot));
    } else if (st.isDirectory()) {
      push(loadSkillFile(join(full, "SKILL.md"), skillsRoot));
    }
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** 目录摘要（渐进披露 · 第一层）：只放 name + description */
export function formatSkillCatalog(
  skills: SkillDef[],
  opts?: { viaTool?: boolean },
): string {
  if (!skills.length) return "";
  const viaTool = opts?.viaTool ?? false;
  const lines = [
    "## 可用 SKILL 目录（仅元数据；全文未加载则不要假装已读规程）",
    "",
    viaTool
      ? "需要某规程时，请调用工具 load_skill（传入 name）加载全文。这与 Pi 用 read 读 SKILL.md 同构：由模型决定何时加载。"
      : "需要某规程时，应等待 Harness 注入全文，或用户使用 /skill:name。",
    "",
  ];
  for (const s of skills) {
    lines.push("- " + s.name + ": " + s.description);
  }
  return lines.join("\n");
}

/** Pi 风格：模型通过工具按需加载全文（对照 Pi 的 read SKILL.md） */
export const LOAD_SKILL_TOOL: ToolDef = {
  name: "load_skill",
  description:
    "加载指定 SKILL 的全文规程。目录里只有 name/description；需要按某规程输出或执行前，必须先调用本工具。",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "SKILL 名称，必须与目录中的 name 一致，如 weather-brief",
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
};

/**
 * 执行 load_skill：把 SKILL 全文作为纯文本 ToolResult 回写 Context。
 * 对齐 Pi 的 read(SKILL.md)：工具结果 ≈ 文件正文，不包一层 JSON。
 * 审计信息已在 tool_start 的 arguments.name / Trace 里，不必塞进 content。
 */
export function executeLoadSkill(
  call: ToolCall,
  skills: SkillDef[],
): ToolResult {
  const name = String(call.arguments?.name ?? "").trim();
  const skill = skills.find((s) => s.name === name);
  if (!skill) {
    return {
      toolCallId: call.id,
      name: call.name,
      content:
        "load_skill failed: unknown skill \"" +
        name +
        "\". Known: " +
        skills.map((s) => s.name).join(", "),
      isError: true,
    };
  }
  // 纯 Markdown 正文（可带一行路径注释，便于人眼对照，仍非 JSON 壳）
  return {
    toolCallId: call.id,
    name: call.name,
    content: "# SKILL: " + skill.name + " (" + skill.path + ")\n\n" + skill.body,
  };
}

/** 全文块（渐进披露 - 第二层） */
export function formatSkillFull(skill: SkillDef): string {
  return [
    "## SKILL 全文 - " + skill.name,
    "",
    "> path: " + skill.path,
    "",
    skill.body,
  ].join("\n");
}

/**
 * 从用户 prompt 解析显式技能命令：/skill:name 或 /skill name
 */
export function parseSkillCommands(prompt: string): string[] {
  const names: string[] = [];
  const re = /\/skill(?::|\s+)([A-Za-z0-9_-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt))) {
    names.push(m[1]);
  }
  return [...new Set(names)];
}

/** 粗分词：英文 token + 中文 2~4 字滑动片（学习向，非 NLP） */
function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const en = lower.match(/[a-z0-9]+/g) || [];
  const dashed = lower.match(/[a-z0-9]+(?:-[a-z0-9]+)+/g) || [];
  const parts = dashed.flatMap((d) => d.split("-"));
  const out = new Set<string>([...en, ...parts]);
  const cjk = text.match(/[\u4e00-\u9fff]+/g) || [];
  for (const seg of cjk) {
    if (seg.length <= 4) out.add(seg);
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n <= seg.length; i++) {
        out.add(seg.slice(i, i + n));
      }
    }
  }
  return [...out].filter((t) => t.length >= 2);
}

export type SkillMatchHit = {
  name: string;
  score: number;
  reasons: string[];
};

/**
 * 未指定 SKILL 时的自动分析（启发式）：
 * prompt 与 skill.name / description 的英文 token、中文片段重叠打分。
 */
export function matchSkillsByPrompt(
  prompt: string,
  skills: SkillDef[],
  opts?: { minScore?: number; limit?: number },
): SkillMatchHit[] {
  const minScore = opts?.minScore ?? 2;
  const limit = opts?.limit ?? 3;
  if (!prompt.trim() || !skills.length) return [];

  const promptLower = prompt.toLowerCase();
  const q = new Set(tokenize(prompt));

  const hits: SkillMatchHit[] = [];
  for (const s of skills) {
    const bag = tokenize(s.name + " " + s.description);
    const reasons: string[] = [];
    let score = 0;

    for (const t of bag) {
      if (q.has(t)) {
        const w = t.length >= 3 ? 2 : 1;
        score += w;
        if (reasons.length < 8) reasons.push("重叠: " + t);
      } else if (t.length >= 2 && promptLower.includes(t.toLowerCase())) {
        // 技能词直接出现在 prompt 子串中（如「天气」）
        score += t.length >= 2 ? 2 : 1;
        if (reasons.length < 8) reasons.push("prompt 含: " + t);
      }
    }

    if (promptLower.includes(s.name.toLowerCase())) {
      score += 5;
      reasons.push("prompt 含 skill 名: " + s.name);
    }

    if (score >= minScore) {
      hits.push({ name: s.name, score, reasons });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export type SkillPhase = {
  phase:
    | "catalog"
    | "auto_match"
    | "auto_model"
    | "agent_tool"
    | "full_inject"
    | "skip";
  title: string;
  summary: string;
  payload: Record<string, unknown>;
};

/**
 * 渐进披露编排：
 * - match/model：Harness 分析后二次注入全文到 system
 * - agent：仅目录 + 提供 load_skill 工具（Pi 风格，由模型按需加载）
 */
export function planSkillInjection(input: {
  baseSystem: string;
  skills: SkillDef[];
  prompt: string;
  skillCatalog: boolean;
  injectSkills: string[];
  skillAuto: "off" | "match" | "model" | "agent";
  preselected?: string[];
}): {
  phases: SkillPhase[];
  result: SkillAssembleResult;
  injectSource:
    | "manual"
    | "command"
    | "auto_match"
    | "auto_model"
    | "agent_tool"
    | "none";
  /** 是否应把 load_skill 加入本轮 tools */
  enableLoadSkillTool: boolean;
} {
  const fromCmd = parseSkillCommands(input.prompt);
  const fromManual = input.injectSkills.filter(Boolean);
  const phases: SkillPhase[] = [];
  const viaTool = input.skillAuto === "agent";
  // agent 模式默认必须有目录，否则模型不知道有哪些 skill
  const includeCatalog =
    input.skillCatalog || viaTool
      ? input.skills.length > 0
      : input.skillCatalog && input.skills.length > 0;

  if (includeCatalog) {
    phases.push({
      phase: "catalog",
      title: "第一层 · 写入 SKILL 目录",
      summary:
        "仅 name+description 进入 system（" +
        input.skills.map((s) => s.name).join(", ") +
        "）" +
        (viaTool ? "；并提示使用 load_skill" : ""),
      payload: {
        catalogNames: input.skills.map((s) => s.name),
        mode: viaTool ? "metadata_plus_load_skill_hint" : "metadata_only",
      },
    });
  }

  let injectFull = [...new Set([...fromManual, ...fromCmd])];
  let injectSource:
    | "manual"
    | "command"
    | "auto_match"
    | "auto_model"
    | "agent_tool"
    | "none" = "none";

  if (fromManual.length) injectSource = "manual";
  else if (fromCmd.length) injectSource = "command";

  if (!injectFull.length && input.skillAuto === "match") {
    const hits = matchSkillsByPrompt(input.prompt, input.skills);
    phases.push({
      phase: "auto_match",
      title: "自动分析 · 启发式匹配",
      summary: hits.length
        ? "选中: " + hits.map((h) => h.name + "(score=" + h.score + ")").join(", ")
        : "未匹配到 SKILL（保持仅目录或纯 base system）",
      payload: { hits, promptPreview: input.prompt.slice(0, 120) },
    });
    injectFull = hits.map((h) => h.name);
    if (injectFull.length) injectSource = "auto_match";
  } else if (!injectFull.length && input.skillAuto === "model") {
    const picked = (input.preselected || []).filter((n) =>
      input.skills.some((s) => s.name === n),
    );
    phases.push({
      phase: "auto_model",
      title: "自动分析 · 模型分类",
      summary: picked.length
        ? "模型选中: " + picked.join(", ")
        : "模型未选中任何 SKILL",
      payload: { preselected: picked },
    });
    injectFull = picked;
    if (injectFull.length) injectSource = "auto_model";
  } else if (!injectFull.length && input.skillAuto === "agent") {
    phases.push({
      phase: "agent_tool",
      title: "Pi 风格 · 等待模型调用 load_skill",
      summary:
        "不预注入全文；已注册 load_skill 工具。模型按需加载后，全文以纯 Markdown 经 tool 消息回写 Context（对齐 Pi read）。",
      payload: {
        tool: LOAD_SKILL_TOOL.name,
        available: input.skills.map((s) => s.name),
        note: "对照 Pi: catalog in system + read SKILL.md",
      },
    });
    injectSource = "agent_tool";
  } else if (!injectFull.length && input.skillAuto === "off") {
    phases.push({
      phase: "skip",
      title: "跳过全文注入",
      summary: "未勾选手动注入、无 /skill 命令、未开自动分析",
      payload: {},
    });
  }

  const result = assembleSystemWithSkills({
    baseSystem: input.baseSystem,
    skills: input.skills,
    includeCatalog,
    injectFull,
    prompt: input.prompt,
    viaTool,
  });

  if (result.injectedNames.length) {
    phases.push({
      phase: "full_inject",
      title: "第二层 · 二次注入全文",
      summary:
        "来源=" +
        injectSource +
        " · 注入=[" +
        result.injectedNames.join(",") +
        "] · system 约 " +
        result.systemContent.length +
        " 字符",
      payload: {
        injectedNames: result.injectedNames,
        injectSource,
        systemChars: result.systemContent.length,
      },
    });
  }

  return {
    phases,
    result,
    injectSource,
    enableLoadSkillTool: viaTool,
  };
}

/**
 * 组装 system：原 system + 可选目录 + 可选全文。
 * injectFull 与 prompt 里的 /skill:xxx 合并去重。
 */
export function assembleSystemWithSkills(input: {
  baseSystem: string;
  skills: SkillDef[];
  includeCatalog: boolean;
  injectFull: string[];
  prompt?: string;
  /** 目录文案是否提示 load_skill（Pi 风格） */
  viaTool?: boolean;
}): SkillAssembleResult {
  const byName = new Map(input.skills.map((s) => [s.name, s]));
  const fromCmd = input.prompt ? parseSkillCommands(input.prompt) : [];
  const wantFull = [...new Set([...input.injectFull, ...fromCmd])].filter((n) =>
    byName.has(n),
  );

  const parts: string[] = [input.baseSystem.trim()];
  const catalogNames: string[] = [];

  if (input.includeCatalog && input.skills.length) {
    parts.push(
      formatSkillCatalog(input.skills, { viaTool: Boolean(input.viaTool) }),
    );
    catalogNames.push(...input.skills.map((s) => s.name));
  }

  const injectedNames: string[] = [];
  for (const name of wantFull) {
    const skill = byName.get(name);
    if (!skill) continue;
    parts.push(formatSkillFull(skill));
    injectedNames.push(name);
  }

  let note = "未启用 SKILL";
  if (input.viaTool && catalogNames.length && !injectedNames.length) {
    note =
      "Pi 风格：目录=[" +
      catalogNames.join(",") +
      "] · 全文待模型 load_skill";
  } else if (catalogNames.length && injectedNames.length) {
    note =
      "目录=[" +
      catalogNames.join(",") +
      "] 全文注入=[" +
      injectedNames.join(",") +
      "]";
  } else if (catalogNames.length) {
    note =
      "仅目录元数据=[" + catalogNames.join(",") + "]（渐进披露第一层）";
  } else if (injectedNames.length) {
    note = "仅全文注入=[" + injectedNames.join(",") + "]（无目录）";
  }

  return {
    systemContent: parts.filter(Boolean).join("\n\n"),
    catalogNames,
    injectedNames,
    note,
  };
}
