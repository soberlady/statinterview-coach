# 代码导读：从可运行示例到核心模块

项目解决的问题是：有限题量下问什么，以及证据不可靠时是否更新能力判断。运行方式见[README](../README.md)，当前版本为 coaching-v3 / 48 道主问题、97 条追问。历史 v2 / 24 题实验与当前产品分开解释。

## 从演示开始

`npm run demo:agent` 使用实际 TypeScript 选题、后验更新和审计模块，评分来自合成夹具；不连接模型或数据库。七道正式题加一次验证追问，输出 8/8 重放与三个自适应决策。`npm run demo:agent -- --check` 核对生成轨迹，`npm run test:demo` 检查演示行为。

## 阅读路线

| 要核对的合同 | 入口 | 阅读重点 |
| --- | --- | --- |
| 离线闭环 | [agent-demo.ts](../scripts/agent-demo.ts) | 观察、更新、选题、终止、重放 |
| 生产策略 | [agent-policy.ts](../app/lib/agent-policy.ts) | 2+2+3、来源追问预算、后验门控 |
| 数学内核 | [rasch-policy.ts](../app/lib/rasch-policy.ts) / [ability.py](../services/agent/src/statinterview_agent/ability.py) | 离散后验、熵、信息增益与区间 |
| 评分边界 | [rubric-evaluator.ts](../app/lib/rubric-evaluator.ts) | 每遍逐项证据、原文基准、故障回退 |
| API 与写入 | [turns/route.ts](../app/api/interviews/%5Bid%5D/turns/route.ts) | 策略校验、批处理、版本竞争、已保存重放 |
| 审计 | [decision-audit.ts](../app/lib/decision-audit.ts) | 五项不变量、候选排名、指纹边界 |
| 训练计划 | [practice-plan.ts](../app/lib/practice-plan.ts) | 服务端题组、来源与排除、独立复测 |
| 语音适配 | [livekit_worker.py](../services/agent/src/statinterview_agent/livekit_worker.py) / [voice_turn.py](../services/agent/src/statinterview_agent/voice_turn.py) | 原始转写、授权控制、超时与权威检查点 |
| 故障注入 | [policy-audit-e2e.mjs](../tests/policy-audit-e2e.mjs) / [browser-recovery.mjs](../tests/browser-recovery.mjs) | 回滚、取消竞争、响应丢失、草稿与复测恢复 |

Python 用于数学/实验与语音 transport，Web 的业务 API 在 TypeScript。共同夹具不证明两端全部状态机、可靠性逻辑或题目选择等价。

## 核查顺序与边界

1. 从原始回答追到评分项引用；缺证据与有证据的错误是否被区分。
2. 从评分动作追到后验更新；VERIFY/ABSTAIN 是否保持原状态。
3. 从当前状态追到合法候选、效用和终止预算；模型是否能绕过策略。
4. 从提交失败追到事务、版本与检查点恢复；区分存储唯一性与外部调用幂等。
5. 从报告追到保存证据与重放；指纹能比较复现结果，不能证明语义正确或防管理员篡改。

设计取舍见[技术问答](INTERVIEW_GUIDE.md)。正式实验和未完成人工验证见[评测](EVALUATION.md)，不要用合成结果替代真人结论。
