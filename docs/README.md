# 技术文档索引

当前代码说明以本目录正式文档为准；历史记录不代表当前测试数量、部署版本或仍未修复的缺陷。文档不包含个人投递安排、私有站点地址或测试者记录。

## 运行与设计

| 文档 | 内容 |
| --- | --- |
| [项目 README](../README.md) | 定位、演示、技术栈与证据摘要 |
| [代码导读](PROJECT_GUIDE_ZH.md) | 从可运行示例定位核心模块 |
| [架构](ARCHITECTURE.md) | 决策边界、持久化、恢复、双语言职责 |
| [设计问答](INTERVIEW_GUIDE.md) | 关键取舍、可验证结论与代价 |
| [证据报告设计](REPORT_REFINEMENT_ZH.md) | 逐项反馈、追问关联及复测解释 |
| [实现状态](IMPLEMENTATION_STATUS.md) | 已实现与待验证事项 |
| [贡献与开发](../CONTRIBUTING.md) | 本地安装与验证入口 |
| [语音运行手册](LIVEKIT_RUNBOOK.md) | 适配器配置、控制与恢复合同 |
| [转写排障案例](VOICE_DISPLAY_DIAGNOSTICS_ZH.md) | 显示与保存的不同路径、观测缺口 |

## 评测与安全

| 文档 | 内容 |
| --- | --- |
| [评测总览](EVALUATION.md) / [冻结实验](EXPERIMENT_RESULTS.md) | 工程证据与仿真结果边界 |
| [评分协议](SCORING_EVALUATION.md) / [语音协议](VOICE_EVALUATION.md) | 真人研究样本、指标与门禁 |
| [成本观测](COST_OBSERVABILITY.md) | 用量、定价与缺失数据解释 |
| [发布检查](RELEASE_CHECKLIST.md) / [验证路线图](NEXT_STEPS_ZH.md) | 自动检查与待完成人工验收 |
| [依赖风险](DEPENDENCY_UPGRADE_ZH.md) / [安全策略](../SECURITY.md) | 版本维护、审计及权限边界 |
| [上游边界](UPSTREAM.md) | 框架使用与原创实现范围 |

## 历史记录

[archive](archive/README.md) 仅保留有独立技术价值的迁移、故障复现和界面验收记录。已落地的设计与回归结论已并入正式文档；旧部署标识、临时备份路径和个人求职待办不作为公开技术资料保留。Git 历史仍保存原文件版本，本轮不重写历史。
