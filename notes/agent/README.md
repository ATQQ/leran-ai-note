瞎学的不保证对！

# Prompt
* 角色（Person）
* 任务（Task）
* 约束（Constraints）
* 输出格式（Output）

# Zero-shot

不给任何示例，直接丢任务。“把这句话翻译成英文”——这就是 Zero-shot。

**规则是抽象的，示例是具象的。模型更擅长模仿具象模式，而不是精确遵循抽象规则。**

在系统提示词里约束不一定会生效（比如以固定的json 格式返回 可能在字段翻译上有出入）

# Few-shot

先给几个示例（输入→输出对），让模型"看懂"你要的模式，再让它做新的。

用示例覆盖边界

# Chain of Thought (CoT)

>同一道数学题 “小明有 5 个苹果，吃了 2 个，又买了 3 个，给了小华 1 个，还剩几个？”

>为什么直接问 “还剩几个？” 容易出错，而加上一句 “Let’s think step by step” 准确率就大幅提升？你觉得这背后是什么原理？

**LLM 逐 token 生成，不强制它写出中间步骤，它就会"跳步"——跳步越多，出错概率越大**


CoT 有两种用法：

Zero-shot CoT：直接加一句 “Let’s think step by step”

Few-shot CoT：给几个示例，每个示例里展示完整的推理过程


场景	用哪种	原因
通用推理（数学、逻辑、常识）	Zero-shot CoT	模型训练时已见过大量推理模式
领域专有推理（竞态检测、法律分析、特定业务）	Few-shot CoT	需要教模型"这个领域怎么思考"

CoT 本质：强制模型写出中间推理步骤，减少"跳步"带来的错误

Zero-shot CoT："Let's think step by step" 一句搞定

Few-shot CoT：给示例，展示完整推理链（问题 → 步骤1 → 步骤2 → 答案）

# response_format
https://developers.openai.com/api/docs/guides/structured-outputs?example=ui-generation

1	System Prompt 描述格式	⭐⭐	靠模型"记住"指令，容易漂移
2	Few-shot 示例	⭐⭐⭐	靠模仿，边界 case 仍需覆盖
3	response_format / constrained decoding	⭐⭐⭐⭐⭐	API 层面强制约束 token 采样

# Function Calling
name description arguments

能做什么 + 适用场景 + 限制

工具执行错误丢回给模型，让它生成友好的降级回复；但安全相关的错误代码层兜底，错误信息要脱敏。

# 测试
面试题：设计一个"智能客服助手"，用户可以用自然语言问订单状态、申请退款、查询物流。

要求你设计：

System Prompt 的核心要素（Concept 2）

Tool Schema — 至少设计 2 个工具（Concept 8）

多轮调用链路 — 用户说"我的订单到哪了？如果还没发货就退款"

错误处理 — 用户说"帮我退一下我去年买的那个东西"但没提供订单号


---
模型判断意图，代码判断状态

# summary

* System Prompt 四要素：角色、任务、约束、输出格式
* Few-shot vs Zero-shot：有示例 vs 无示例；示例覆盖边界 case
* CoT：Zero-shot（一句话） vs Few-shot（给推理链示例）；通用推理用前者，领域专有推理用后者
* 结构化输出最强手段：Constrained Decoding（API 级 token 约束，非 prompt 建议）
* Function Calling 本质：模型不执行，只输出 tool_calls（JSON）；你的代码才是执行者
* Tool Schema 三法则：能做什么 + 适用场景 + 限制
* 单轮调用：2 次 API 请求，tool 消息必须紧跟 assistant(tool_calls)
* 多轮调用：并行（无依赖）vs 串行（有依赖）；循环控制 = max_iterations + 重复检测
* 错误处理：工具执行失败丢回给模型（脱敏后）；安全相关代码兜底
* Prompt 调试：定位 → 修改 → 回归测试（不能只测修复的 case）