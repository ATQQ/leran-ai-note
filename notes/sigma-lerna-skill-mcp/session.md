# Session: MCP 和 Skill 原理深度理解

## Learner Profile
- Level: intermediate-to-advanced
- Language: zh
- Diagnosed at: 2026-03-22
- Prior knowledge: 有 MCP 和 Skill 实战经验，了解配置层，但缺系统化原理
- Misconception identified: Skill 本质是"指令注入"而非"CLI 调用"

## Concept Map
| # | Concept | Prerequisites | Status | Score | Last Reviewed | Review Interval |
|---|---------|---------------|--------|-------|---------------|-----------------|
| 1 | 为什么需要 MCP | - | mastered | 90% | 2026-03-22 | 4d |
| 2 | MCP 三角色架构：Host / Client / Server | 1 | mastered | 85% | 2026-03-22 | 4d |
| 3 | JSON-RPC 2.0：MCP 的通信基础 | 2 | mastered | 90% | 2026-03-22 | 4d |
| 4 | MCP 三大原语：Tools / Resources / Prompts | 2 | mastered | 90% | 2026-03-22 | 4d |
| 5 | 工具 Schema 的注册与发现机制 | 3, 4 | mastered | 85% | 2026-03-22 | 4d |
| 6 | MCP 请求-响应完整生命周期 | 5 | mastered | 85% | 2026-03-22 | 4d |
| 7 | MCP vs Function Calling：本质区别 | 6 | mastered | 90% | 2026-03-22 | 4d |
| 8 | Skill 本质：指令注入而非执行 | - | mastered | 90% | 2026-03-22 | 4d |
| 9 | Skill 生命周期：加载 → 触发 → 执行 | 8 | mastered | 85% | 2026-03-22 | 4d |
| 10 | Skill 与 MCP 的协同模式 | 7, 9 | mastered | 85% | 2026-03-22 | 4d |
| 11 | 实战：实现一个 MCP Server | 1-7 | mastered | 85% | 2026-03-22 | 4d |
| 12 | 实战：编写一个 Skill | 8-10 | not-started | - | - | - |

## Misconceptions
| # | Concept | Misconception | Root Cause | Status |
|---|---------|---------------|------------|--------|
| 1 | Skill | "Skill 调用 CLI 去读取内容" | 将 Skill 与 MCP 功能混淆 | resolved |

## Session Log
- [2026-03-22 16:16] Diagnosed: intermediate，有实战经验，缺系统原理
- [2026-03-22 16:22] 诊断性问题：MCP 核心价值理解正确（标准化互操作性）
- [2026-03-22 16:27] 诊断性问题：MCP 调用流程理解正确
- [2026-03-22 16:29] 诊断性问题：Skill 本质有误解，已澄清
- [2026-03-22 17:30] #1-#5 全部掌握
- [2026-03-22 17:40] #6-#7 全部掌握，MCP 部分达到 Mastery Gate (80%)
- [2026-03-22 17:45] #8 Skill 本质纠正完成
- [2026-03-22 17:50] #9-#10 Skill 协同模式掌握
- [2026-03-22 17:54] #11 实战设计完成
- [2026-03-22 19:28] Mastery Check 完成，总分约 87%
- [2026-03-22 19:28] 生成学习记录 learning-record.md
- [2026-03-22 19:28] 课程完成

## Mastery Check Results
| 题号 | 主题 | 得分 |
|------|------|------|
| 1 | 完整调用链路 | 85/100 |
| 2 | Resources vs Tools 判断 | 90/100 |
| 3 | MCP 跨平台复用 | 75/100 |
| **总分** | | **~87%** |
