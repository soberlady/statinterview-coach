# 中文项目导读：从运行到面试讲解

## 当前版本说明（2026-10-03）

本项目定位为个人面试前的训练 Agent，面向中文数据分析岗位的练习者；你用它展示 Agent 开发能力，业务题目不必改成 Agent 开发面试题。
当前 coaching-v3 题库为 48 道主问题、97 条追问，并新增“诊断 → 两题有提示练习 → 一题新场景无提示复测”。
下文 4,000 候选人、3.83% MAE 等数字属于旧版 v2 与冻结的 24 题题库；不代表当前升级效果。
实施细节、边界和需要你完成的真人验收见 [训练闭环升级](COACHING_UPGRADE_ZH.md)。

StatInterview Coach 是一个中文数据分析面试训练 Agent。它关注的问题是：**有限题量下应该问什么，以及证据不可靠时是否应该更新能力判断。**

这是可运行的 Agent 工程项目。公开页面展示合成场景，完整语音系统用于私有测试；真人评分有效性仍待验证。

## 1. 面试官两分钟运行

只需 Node.js 22.13 及以上版本。首次安装需要网络，演示运行不需要 Python、API key、数据库或语音服务。

```sh
git clone https://github.com/soberlady/statinterview-coach.git
cd statinterview-coach
npm ci
npm run demo:agent
```

程序会调用应用实际使用的 TypeScript 选题、能力更新与审计模块，完成七道正式题和一次追问，输出：

```text
VERIFY → ABSTAIN → ACCEPT → ACCEPT → ACCEPT → ACCEPT → ACCEPT → ACCEPT
Replay: 8/8; adaptive: 3; terminal: COMPLETE
Approved-question tamper: DETECTED
```

- 前两轮证据不足，能力后验保持不变。
- 之后六轮接受合成证据，允许更新后验。
- 七道正式题依次属于两个公共锚点、两个冻结的岗位基线、三个后验自适应问题。
- 将某轮题目替换成另一道题库内合法题目，重放仍会识别出它并非策略选择的题目。

所有回答和评分均为 `DEMO_FIXTURE` 合成夹具；选题、后验和指纹由代码计算。这条命令验证策略机制，不验证模型评分质量、语音识别质量或真人效果，也没有执行数据库持久化。

完整生成结果：[agent-demo.json](../content/agent-demo.json)。

```sh
npm run demo:agent -- --check   # 检查已保存的演示结果是否与代码一致
npm run test:demo              # 运行演示的行为及可复现性回归测试
```

公开网页直接读取这份产物。策略改动后运行 `npm run demo:agent -- --write`，检查变化后连同代码提交。CI 会再次计算并核对产物。

## 2. 代码阅读路线

| 想核对什么 | 入口 | 重点 |
| --- | --- | --- |
| 完整离线闭环 | [agent-demo.ts](../scripts/agent-demo.ts) | 观察、评分、更新、选题、终止、审计 |
| 生产选题策略 | [agent-policy.ts](../app/lib/agent-policy.ts) | 三阶段、追问预算、能力更新门槛 |
| 概率模型 | [rasch-policy.ts](../app/lib/rasch-policy.ts) / [ability.py](../services/agent/src/statinterview_agent/ability.py) | Rasch 响应概率、后验与信息增益 |
| 原始证据与评分边界 | [rubric-evaluator.ts](../app/lib/rubric-evaluator.ts) | 双遍评分、逐字引用、失败回退、转写修复 |
| 可恢复的写入 | [turns/route.ts](../app/api/interviews/[id]/turns/route.ts) | 先核对策略和版本，再原子保存 |
| 决策审计 | [decision-audit.ts](../app/lib/decision-audit.ts) | 重算选题、五个不变量、候选题效用分解 |
| 实时语音 | [livekit_worker.py](../services/agent/src/statinterview_agent/livekit_worker.py) / [voice_turn.py](../services/agent/src/statinterview_agent/voice_turn.py) | 最终转写、晚到片段、超时和检查点恢复 |
| 故障证据 | [policy-audit-e2e.mjs](../tests/policy-audit-e2e.mjs) | 回滚、并发暂停、错误题目、恢复流程 |

Python 提供策略数学内核和语音 worker，TypeScript 执行网页 API 的策略。共享 golden fixtures 覆盖后验、信息增益和效用公式；它们不意味着两个实现的全部会话行为已经逐项等价。

## 3. 为什么这样设计

**Agent 的决策边界。** 模型负责理解与对话；正式问题、可用动作、证据是否能进入能力状态，由代码约束。模型不能直接把一道自创题写入面试，也不能用自报置信度绕过可靠性规则。

**为什么需要弃权。** 口语转写缺字、题意误解、回答内容不足，可能表现得很相似。系统先进行有预算的追问，仍无可靠证据就保留先验。弃权表示证据不足，不等同于给候选人记零分。

**为什么保留原始转写。** 修复文本只能辅助评分；引用必须是原文中的逐字子串。模型补出“更正确”的答案会污染评测，因此数字、否定、长度和相似度都受约束。

**为什么有两套语言。** Python 适合实验和 LiveKit worker，TypeScript 适合 Cloudflare 边缘 API。代价是语义漂移，需要共享测试和清楚的职责边界。面试时应能解释这一取舍，不要把所有逻辑双写当作优势。

**SHA-256 能证明什么。** 指纹帮助比较同一策略版本的重放结果。它不是数字签名，不会阻止有数据库写权限的人同时改记录和指纹，也不证明评分语义正确。

## 4. 如何验证工程质量

完整检查需要 Python 3.11 及以上版本；如已建立项目虚拟环境，命令会优先使用它。

```sh
python -m pip install -e "./services/agent[dev]"
npm run verify
```

检查包括配置形状、题库、lint、完整 TypeScript 类型检查、Python 测试、构建、TypeScript 测试、D1 端到端流程及冻结实验的重算。

若已有 `.env.local` 只配了一部分可选服务，`doctor` 会报错。先单独验证代码：

```sh
npm run verify:code
```

`verify:code` 仅省略配置预检，仍执行全部代码和本地 D1 检查。它不代表部署配置可用，也不是网络隔离沙箱；构建仍遵循框架的本地环境加载规则。部署前仍需 `npm run doctor`。

Python 单元测试只需要 `[dev]`；CI 会在之后另装锁定的生产语音依赖，并检查 worker 导入，避免纯策略测试被媒体 SDK 的原生库阻塞。

## 5. 可以诚实展示的结果

| 证据 | 可以说 | 不能推导出 |
| --- | --- | --- |
| 合成 Agent 演示 | 8/8 选题重放一致，3 个自适应决策，合法题目替换被检测 | 模型能准确评价真人 |
| 4,000 候选人的冻结配对仿真 | 相同七题预算下，加权 MAE 相对固定题序降低 3.83% | 招聘准确率提高 3.83% |
| 语音与 API 故障注入测试 | 指定超时、重复、恢复和并发失败路径符合预期 | 已经达到生产级语音稳定性 |
| 真实语音测试 | 已有私有测试和针对失败样本的修复 | 最新版本已完成 30 次正式语音协议 |
| 评分评测协议 | 已有合成验证与发布门 | 已完成人工双标和正式评分有效性验证 |

完整实验假设见 [EXPERIMENT_RESULTS.md](EXPERIMENT_RESULTS.md)，人工样本要求见 [SCORING_EVALUATION.md](SCORING_EVALUATION.md)。

## 6. 简历写法

按自己实际理解和参与程度取舍，避免背诵不熟悉的实现：

> **StatInterview Coach｜中文自适应面试训练 Agent**
>
> - 实现“公共锚点—岗位基线—后验自适应”三阶段选题，结合贝叶斯能力状态与信息增益，在固定题量预算内进行个性化测量；低可靠证据触发有界追问或弃权。
> - 集成 LiveKit 实时语音与双遍量表评分，保留原始转写并约束证据引用，结合转写稳定等待、版本检查点和原子写入处理提前提交与恢复问题。
> - 实现决策重放、候选题效用分解和策略指纹，提供无需密钥的可复现示例；加入跨语言公式一致性、故障注入、类型检查和 CI 验证。
> - 在 4,000 个合成候选人的冻结配对仿真中，相同七题预算下加权 MAE 较固定题序下降 3.83%；真人评分有效性仍在验证。

不要把“模型双遍评分”说成“两位真人独立标注”，也不要把此项目描述成已上线的多租户招聘系统。

语音显示故障的证据链、修复与复现方法见 [转写排障与回归](VOICE_DISPLAY_DIAGNOSTICS_ZH.md)。

## 7. 投递前后的行动

具体顺序、耗时与验收标准见 [NEXT_STEPS_ZH.md](NEXT_STEPS_ZH.md)。不必等大规模用户研究完成才开始投递；先把工程演示和真实边界讲清楚。
