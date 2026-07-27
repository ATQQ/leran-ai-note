# leran-ai-note

## 技能
* [sanyuan0704/sigma](https://github.com/sanyuan0704/sanyuan-skills/tree/main/skills/sigma)

## 目录

### 笔记
1. [SKILL 和 MCP 相关概念](./notes/sigma-lerna-skill-mcp/)
2. [Agent / Prompt / Tool Use](./notes/agent/)
3. [经验与结论库（knowledge）](./notes/knowledge/) — 面试向结论；专题见 [ai-app-interview](./notes/knowledge/ai-app-interview/)（`conclusions.md` / `review.html`）
4. [SSE 学习笔记](./notes/sse/) — 协议、限制、Demo
5. [Claude Code 常用指令](./notes/cc/)

### 动手 Demo
6. [MCP Demo（stdio）](./notes/mcp-demo/) — Tools / Resources / Prompts 最小可跑
   ```bash
   cd notes/mcp-demo && npm install && npm run inspect
   ```
7. [Function Calling Demo](./notes/function-call-demo/) — OpenAI / Anthropic 双格式 + 步骤回放
   ```bash
   cd notes/function-call-demo
   cp .env.example .env   # 填 BASE_URL / API_KEY / MODEL
   npm run openai         # 或 npm run anthropic → 生成 traces/*.json
   npm run viewer         # http://127.0.0.1:8765/viewer.html
   ```

## 学习过程用到的工具
>很杂，组合着用

* ~~[WorkBuddy](https://www.codebuddy.cn/work/)~~
* [Trae SOLO](https://solo.trae.ai/)
* ~~[codebuddy-code](https://www.codebuddy.cn/cli/)~~
* [Cursor](https://www.cursor.com/)

## 学习资料
* https://github.com/KimYx0207/AI-Coding-Guide-Zh
....


## 几个头部开源的中转
* https://github.com/router-for-me/CLIProxyAPI
* https://github.com/Wei-Shaw/sub2api
* https://github.com/songquanpeng/one-api


## AI Usage
* https://github.com/vibe-cafe/vibe-usage
* https://github.com/mm7894215/TokenTracker
* https://github.com/robinebers/openusage

## 计划

## 算法（DDDD）
* https://leetcode.cn/studyplan/top-interview-150/
