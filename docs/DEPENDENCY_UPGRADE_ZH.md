# 依赖升级与安全检查

日期：2026-10-04。范围：本地依赖、兼容性验证与 CI；未部署到远程环境。

## 目标与边界

保持个人面试训练产品定位。本轮维护底层框架与开发工具，保留七题诊断的 2+2+3 结构、评分可靠性门控、追问、报告和三题专项训练。未修改业务 API、Agent 流程、题库和评分规则。

## 升级内容

| 依赖 | 升级前 | 升级后 |
| --- | --- | --- |
| Next / eslint-config-next | 16.2.11 | 16.3.8 |
| React / React DOM / React Server DOM | 19.2.6 | 19.2.8 |
| Vinext | 0.0.50 | 1.0.1 |
| Vite | 8.0.13 | 8.3.2 |
| Vite RSC 插件 | 0.5.26 | 0.5.35 |
| Cloudflare Vite 插件 | 1.37.1 | 1.62.5 |
| Wrangler | 4.92.0 | 4.147.0 |
| Drizzle Kit | 0.31.10 | 0.31.11 |

核心版本精确固定，锁文件同步更新。兼容范围内的间接依赖使用普通 `npm audit fix` 更新，未使用 `--force`。审计建议中的旧版 Next ESLint、Vinext、Drizzle 降级不能直接作为解决方案。

Vinext 1.x 将开发启动委托给 Vite，默认端口随之改变。启动包装脚本显式保留 `3000` 默认端口及 `PORT` 环境变量，并透传附加参数；`npm run dev -- --port 4175 --host localhost` 可恢复现有本地预览地址。

两个限定覆盖保留在 `package.json`：

- 仅 `@esbuild-kit/core-utils@3.3.2` 的 esbuild 替换为 `0.25.12`。这个旧工具的依赖范围停留在受影响版本；新增测试实际运行同步、异步 TypeScript 转换、源映射和数据库结构导出，验证兼容性。
- 仅 `fflate@0.7.3` 替换为同系列修复版 `0.7.5`，覆盖 Satori 与字体解析库共用的旧依赖。上游解除固定旧版本后应移除覆盖。

## 审计结果与剩余问题

完整 `npm audit`（包括开发与构建依赖）的受影响包计数：

| 级别 | 升级前 | 升级后 |
| --- | ---: | ---: |
| critical | 1 | 0 |
| high | 23 | 8 |
| moderate | 6 | 0 |
| low | 1 | 0 |
| 合计 | 31 | 8 |

剩余 8 个受影响包来自 **同一个尚未修复的 `braces` 深层嵌套模式栈溢出问题**，不是 8 个独立漏洞。截至核查日期，最新 `braces` 仍为 `3.0.3`，上游公告无修复版。原始 `npm audit` 仍以非零状态退出，不能宣称零漏洞。

目前的调用链为：

1. Next ESLint 插件 → fast-glob → micromatch → braces。
2. Vinext 构建配置 → CommonJS / 动态导入插件 → fast-glob → micromatch → braces。

检查应用和 Worker 源码未发现这些解析库的导入或候选人输入传入路径；当前使用来自仓库配置与模块路径的模式。构建产物检索也未发现该链的模块标记。这是针对当前部署代码的有限可达性判断，**不等于漏洞已修复或所有路径均被证明安全**。开发服务器仅用于本地开发；不要将不可信代码或外部模式交给这些构建工具。如果增加用户自定义 glob、动态代码构建、改变部署入口或调整依赖用途，应立即重新检查。

## 持续检查

`npm run audit:dependencies` 查询完整 npm 审计报告，CI 在安装后执行该命令。普通离线代码验证不需要连接 npm 审计服务。

唯一临时例外记录在 `security/npm-audit-exceptions.json`，于 **2026-11-04 00:00 UTC** 到期。检查按漏洞编号、包版本、严重级别、已检查的依赖链和锁文件开发依赖标记精确匹配，逐条追踪间接依赖，始终打印 `REVIEWED, UNFIXED`。出现新公告、风险升级、包版本或依赖用途变化、未检查的依赖链、例外到期时检查失败；网络失败或报告不完整也不会算通过。

后续维护者应在到期前重新查询上游。发布修复版后优先升级并删除例外；仍无修复版时重新检查实际输入和构建边界，不能只延长日期。该日期是检查门禁的到期时间，不是后台提醒任务。

## 验证记录

完整回归结果见本次执行日志 `.tmp/dependency-upgrade/verify.log`；本地日志不纳入版本控制。新增安全门禁测试覆盖同一包的新公告、风险升级、生产依赖用途变化、循环或缺失依赖信息、例外到期和不完整报告。新增工具兼容测试覆盖旧加载器和实际数据库表结构。

- `npm run verify:code` 整体退出状态为 0；内容校验、lint、typecheck、生产构建通过。
- Python：103 项通过，1 项因可选 LiveKit 运行时依赖未安装而跳过。
- JavaScript / 工具检查：25 项通过；TypeScript 业务检查：83 项通过。
- 本地 D1 与浏览器：七题诊断、三题训练、确定性演示可重放；五组浏览器检查覆盖移动端与键盘、草稿刷新和暂停恢复、丢失响应重试、最终提交和完成失败恢复、无提示复测刷新。
- 合成实验、评分与语音夹具、Agent 演示和 12 个训练情景均重新生成完成。它们验证程序行为，不验证真人效果。
- `npm run doctor`：0 个错误，2 个可选服务未配置提示；依赖树检查及 `npm ci --dry-run --ignore-scripts` 通过。后者仅验证安装计划与锁文件一致性，不等于在另一台机器上完成了实际安装。
- 完整审计门禁通过，但明确输出上述 8 个未修复受影响包。
- 本地预览恢复到 `http://localhost:4175/`，仅监听回环地址；首页与 `/api/health` 返回 200，数据库、48 道主问题与策略均就绪。

构建仍有 Vinext 内部模块同时被静态与动态导入的拆包提示；开发环境还有 Vite 对未来原生配置加载方式的提醒。这些提示没有造成当前构建或浏览器回归失败，本轮没有通过修改第三方源码或隐藏告警来处理。

升级前对 60 个业务、API、题库与 Agent 文件保存 SHA-256 指纹，升级后逐个对照，确认未变化。

配置检查中 LiveKit 与真实语义评分服务仍未配置；本地回归使用合成回答和模拟评分服务。真实语音质量、评分准确性和学习效果仍需人工验证，不能由依赖升级推导。

## 上游依据

- [Next Windows 服务端漏洞公告](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36)
- [React Server Components 公告](https://github.com/react/react/security/advisories/GHSA-wx67-qw84-cm4g)
- [Vite Windows 文件访问公告](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff)
- [esbuild 开发服务跨源访问公告](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99)
- [fflate 修复版本与公告](https://github.com/advisories/GHSA-px8p-9vwx-vf98)
- [braces 公告](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)及[上游问题](https://github.com/micromatch/braces/issues/70)
