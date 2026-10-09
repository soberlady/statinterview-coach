import type { Metadata } from "next";
import Link from "next/link";
import benchmark from "@/content/policy-benchmark.json";
import scoringBenchmark from "@/content/scoring-benchmark.json";
import voiceBenchmark from "@/content/voice-benchmark.json";
import coachingBenchmark from "@/content/coaching-benchmark.json";

export const metadata: Metadata = {
  title: "实验与方法",
  description: "自适应选题与可靠性防护的可复现离线实验。",
};

const PROFILE_LABELS: Record<string, string> = {
  balanced: "均衡型岗位",
  growth_analytics: "增长分析",
  experiment_analysis: "实验分析",
  data_engineering: "数据工程分析",
};

function formatMetric(
  value: number | null | undefined,
  digits = 3,
) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : "未测量";
}

function formatPercent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${(value * 100).toFixed(0)}%`
    : "未测量";
}

function releaseStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    NOT_READY: "待完成真人验收",
    NOT_MEASURED: "尚未完成真实测量",
    PASS: "验收门槛已通过",
    FAIL: "验收门槛未通过",
  };
  return labels[status] ?? "状态待确认";
}

function acceptanceLabel(threshold: string): string {
  const labels: Record<string, string> = {
    HIGH: "仅采信高可靠证据",
    HIGH_MEDIUM: "采信高、中可靠证据",
    ALL: "采信全部证据",
  };
  return labels[threshold] ?? "采信门槛待确认";
}

export default function LabPage() {
  const adaptive = benchmark.adaptiveSelection.aggregate.adaptive;
  const fixed = benchmark.adaptiveSelection.aggregate.fixed;
  const random = benchmark.adaptiveSelection.aggregate.random;
  const comparison =
    benchmark.adaptiveSelection.comparisons.adaptive_vs_fixed;
  const guardrail = benchmark.reliabilityGuardrail;
  const profileEntries = Object.entries(
    benchmark.adaptiveSelection.by_profile,
  );
  const scoringIsSynthetic =
    scoringBenchmark.design.provenance.includes("synthetic_fixture");
  const scoringReleaseStatus = scoringBenchmark.releaseGate.status;
  const voiceReleaseStatus = voiceBenchmark.releaseGate.status;

  return (
    <main id="main-content" tabIndex={-1} className="lab-shell">
      <header className="report-header">
        <Link className="brand compact" href="/">
          <span className="brand-mark">S</span>
          <strong>StatInterview</strong>
        </Link>
        <span>实验与方法</span>
        <Link className="quiet-button" href="/">
          返回产品
        </Link>
      </header>

      <section className="lab-hero">
        <div>
          <p className="eyebrow">项目验证依据</p>
          <h1>每次决策如何验证，实验结论如何解读。</h1>
          <p>
            从选题是否可重放、证据不足时是否停止更新，到如何比较不同选题方式，
            这里说明项目已经验证的行为、实验依据，以及仍待真人验证的效果。
          </p>
        </div>
        <div className="lab-boundary">
          <span>结论边界</span>
          <strong>离线合成实验，不是招聘效度证明</strong>
          <p>
            它验证策略实现是否按设计工作；真实学习效果仍需匿名回答标注和用户实验。
          </p>
        </div>
      </section>

      <section className="lab-grid" aria-label="当前实现的验证结果">
        <article className="lab-card lab-card-wide">
          <p className="card-index">当前实现 · 行为检查</p>
          <h2>当前实现：选题行为与回放检查</h2>
          <p>
            {coachingBenchmark.cases.length} 个预设分数的合成场景均完成七题选题与重放；
            {coachingBenchmark.profilesWithDifferentLowHighRoutes.length} 类岗位在低分和高分证据下产生不同题序，包含均衡型岗位。
            这只验证分数会影响决策、题量约束和回放一致性，不证明评分准确或训练有效。
            两题练习加一道新场景复测的闭环还需要真人验收。
          </p>
        </article>
        <article className="lab-card lab-card-wide">
          <p className="card-index">历史基准 · 方法验证</p>
          <h2>历史基准实验：比较选题方式</h2>
          <p>以下误差指标来自早期策略与冻结的 24 题题库，仅作方法验证参考，不代表当前 48 题训练系统的效果。合成候选人是程序生成的能力与回答数据，不是真实用户。</p>
          <p>平均绝对误差（MAE）衡量估计能力与模拟中已知能力相差多少，越低越好。误差下降不等于答题正确率提升，也不代表真人训练收益。</p>
          <details className="presentation-details">
            <summary>这些指标怎样解读？</summary>
            <ul className="lab-list">
              <li>MAE：平均相差多少；RMSE：对较大误差更敏感。选题实验按内部能力尺度计算。</li>
              <li>配对 95% 区间：同一模拟候选人的策略误差差值，区间未跨 0 是这组模拟数据中的差异证据。</li>
              <li>可信区间覆盖率：估计区间包含模拟真实能力的比例，用于检查不确定性估计是否过度自信。</li>
              <li>选中岗位权重：所选题目的能力维度在岗位中有多重要，数值越大表示更偏向相关维度。</li>
            </ul>
          </details>
          <details className="presentation-details">
            <summary>查看实验版本与复现范围</summary>
            <p>历史基准采用 three-stage-v2 策略与冻结 24 题；当前实现采用 coaching-v3 策略与 48 题题库。两者的题库和选题规则不同，不能直接沿用历史降幅评价当前实现。历史实验随机种子为 {benchmark.adaptiveSelection.design.seed}，共 {benchmark.adaptiveSelection.design.total_simulated_candidates.toLocaleString("zh-CN")} 位合成候选人。</p>
          </details>
        </article>
      </section>

      <section className="lab-kpis" aria-label="历史基准实验结果">
        <article>
          <span>历史基准 · 自适应与固定题序</span>
          <strong>
            {Math.abs(comparison.relative_mae_change_pct).toFixed(2)}%
          </strong>
          <p>相对固定题序，能力估计平均误差下降</p>
        </article>
        <article>
          <span>配对 95% 区间</span>
          <strong>
            [{comparison.paired_95pct_ci[0].toFixed(3)},{" "}
            {comparison.paired_95pct_ci[1].toFixed(3)}]
          </strong>
          <p>误差差值的区间，未跨 0</p>
        </article>
        <article>
          <span>可信区间覆盖率</span>
          <strong>
            {(adaptive.weighted_90pct_interval_coverage * 100).toFixed(1)}%
          </strong>
          <p>目标为 90%，用于检查过度自信</p>
        </article>
        <article>
          <span>已检测转写故障</span>
          <strong>
            {guardrail.relative_oracle_deviation_reduction_pct.toFixed(0)}%
          </strong>
          <p>追问或保留估计，减少相对理想参照的偏离</p>
        </article>
      </section>

      <section className="lab-grid">
        <article className="lab-card lab-card-wide">
          <div className="section-heading">
            <div>
              <p className="card-index">01 / 选题方式对照</p>
              <h2>历史基准：同样七题，比较不同选题方式</h2>
            </div>
            <span className="legend">
              加权 MAE 越低越好 · n=
              {benchmark.adaptiveSelection.design.total_simulated_candidates}
            </span>
          </div>

          <p className="table-hint">左右滚动查看完整表格</p>
          <div className="benchmark-table" role="table" tabIndex={0} aria-label="策略对比数据，窄屏可横向滚动">
            <div className="benchmark-row benchmark-head" role="row">
              <span role="columnheader">策略</span>
              <span role="columnheader">加权 MAE</span>
              <span role="columnheader">加权 RMSE</span>
              <span role="columnheader">选中岗位权重</span>
            </div>
            {[
              ["自适应策略", adaptive, "best"],
              ["固定题序", fixed, ""],
              ["随机合法题", random, ""],
            ].map(([label, result, className]) => {
              const typed = result as typeof adaptive;
              return (
                <div
                  className={`benchmark-row ${className}`}
                  key={label as string}
                 role="row">
                  <strong role="cell">{label as string}</strong>
                  <span role="cell">{typed.weighted_mae.toFixed(3)}</span>
                  <span role="cell">{typed.weighted_rmse.toFixed(3)}</span>
                  <span role="cell">{typed.mean_selected_job_weight.toFixed(3)}</span>
                </div>
              );
            })}
          </div>

          <div className="profile-bars">
            {profileEntries.map(([profile, values]) => {
              const maximum = Math.max(
                values.adaptive.weighted_mae,
                values.fixed.weighted_mae,
                values.random.weighted_mae,
              );
              return (
                <div className="profile-block" key={profile}>
                  <div className="profile-title">
                    <strong>{PROFILE_LABELS[profile] ?? profile}</strong>
                    <span>岗位加权 MAE</span>
                  </div>
                  {[
                    ["自适应", values.adaptive.weighted_mae, "adaptive"],
                    ["固定", values.fixed.weighted_mae, "fixed-policy"],
                    ["随机", values.random.weighted_mae, "random"],
                  ].map(([label, value, kind]) => (
                    <div className="profile-bar" key={label as string}>
                      <span>{label as string}</span>
                      <i>
                        <b
                          className={kind as string}
                          style={{
                            width: `${(Number(value) / maximum) * 100}%`,
                          }}
                        />
                      </i>
                      <strong>{Number(value).toFixed(3)}</strong>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          <p className="lab-reading">
            关键观察：均衡型岗位上三种策略差异很小；优势主要来自岗位能力权重不均时，
            实验中的 Agent 把有限的三道自适应题分配给更相关的能力维度。这项历史实验支持的是
            “预算约束下的岗位定向测量”，不是宣称万能的智能出题。
          </p>
        </article>

        <article className="lab-card">
          <p className="card-index">02 / 故障场景验证</p>
          <h2>检测到证据损坏后，不强行更新能力</h2>
          <div className="fault-comparison">
            <div>
              <span>总是接受</span>
              <strong>
                {guardrail.always_accept.mean_absolute_deviation_from_oracle.toFixed(
                  3,
                )}
              </strong>
              <small>相对理想参照的偏离</small>
            </div>
            <span>→</span>
            <div className="safe">
              <span>验证 / 弃权</span>
              <strong>
                {guardrail.verify_or_abstain.mean_absolute_deviation_from_oracle.toFixed(
                  3,
                )}
              </strong>
              <small>相对理想参照的偏离</small>
            </div>
          </div>
          <p>
            理想参照是使用未受损答案得到的能力估计。实验把最终答案反转，并假设完整性检查已经发现异常。追问与原答案冲突时，
            策略保留先验、不采信任一答案。本实验只评估“发现以后怎么做”，不代表已测得故障检测召回率。
          </p>
        </article>

        <article className="lab-card">
          <p className="card-index">03 / 实验复现</p>
          <h2>一条命令复现实验</h2>
          <pre tabIndex={0} role="region" aria-label="复现实验的命令，可横向滚动">
            <code>
              python experiments/run_policy_benchmark.py{"\n"}
              {"  "}--candidates-per-profile 1000{"\n"}
              {"  "}--fault-samples 4000 --seed 20260730
            </code>
          </pre>
          <ul className="lab-list">
            <li>题库难度映射到 Rasch θ 尺度</li>
            <li>候选人潜在能力和潜在回答由固定种子生成</li>
            <li>三种策略共享候选人和题目潜在回答</li>
            <li>配对区间基于同一候选人的策略差值</li>
          </ul>
        </article>
      </section>

      <section className="lab-grid">
        <article className="lab-card lab-card-wide">
          <div className="section-heading">
            <div>
              <p className="card-index">04 / 评分验收</p>
              <h2>评分验收：检查一致性与采信风险</h2>
            </div>
            <span className="legend">
              {scoringIsSynthetic ? "合成数据流程检查" : "真实数据评测"} ·{" "}
              {scoringBenchmark.design.sampleCount} 条记录
            </span>
          </div>

          <p>评分一致性用 κ 衡量，越高代表越一致。下面的采信比例表示多少回答达到证据门槛；更严格的门槛会减少可评分回答。此处 MAE 按 0–4 分量表计算，与上方选题实验的能力误差单位不同。</p>
          <p className="table-hint">左右滚动查看完整表格</p>
          <div className="benchmark-table" role="table" tabIndex={0} aria-label="评分器验收数据，窄屏可横向滚动">
            <div className="benchmark-row benchmark-head" role="row">
              <span role="columnheader">检查项</span>
              <span role="columnheader">当前结果</span>
              <span role="columnheader">正式门槛</span>
              <span role="columnheader">结论</span>
            </div>
            <div className="benchmark-row" role="row">
              <strong role="cell">两位评阅者的逐项评分一致性</strong>
              <span role="cell">
                κ {formatMetric(
                  scoringBenchmark.annotationAgreement
                    .criterionQuadraticWeightedKappa,
                )}
              </span>
              <span role="cell">κ ≥ 0.65</span>
              <span role="cell">
                {scoringIsSynthetic ? "仅验证计算链路" : releaseStatusLabel(scoringReleaseStatus)}
              </span>
            </div>
            <div className="benchmark-row" role="row">
              <strong role="cell">模型—共识一致性</strong>
              <span role="cell">
                κ {formatMetric(
                  scoringBenchmark.modelAgreement
                    .criterionQuadraticWeightedKappa,
                )}
              </span>
              <span role="cell">200 条真实双标</span>
              <span role="cell">{releaseStatusLabel(scoringReleaseStatus)}</span>
            </div>
            <div className="benchmark-row" role="row">
              <strong role="cell">逐字证据可定位率</strong>
              <span role="cell">{formatPercent(scoringBenchmark.evidence.verbatimRate)}</span>
              <span role="cell">100%</span>
              <span role="cell">{scoringIsSynthetic ? "合成数据检查通过" : releaseStatusLabel(scoringReleaseStatus)}</span>
            </div>
          </div>

          <div className="profile-bars">
            {scoringBenchmark.riskCoverage.map((point) => (
              <div className="profile-block" key={point.threshold}>
                <div className="profile-title">
                  <strong title={point.threshold}>{acceptanceLabel(point.threshold)}</strong>
                  <span>采信比例 {formatPercent(point.coverage)}</span>
                </div>
                <div className="profile-bar">
                  <span>MAE</span>
                  <i>
                    <b
                      className="adaptive"
                      style={{
                        width: `${Math.min((point.mae ?? 0) * 100, 100)}%`,
                      }}
                    />
                  </i>
                  <strong>{formatMetric(point.mae)}</strong>
                </div>
                <div className="profile-bar">
                  <span>严重错误</span>
                  <i>
                    <b
                      className="random"
                      style={{
                        width: `${(point.severeErrorRate ?? 0) * 100}%`,
                      }}
                    />
                  </i>
                  <strong>{formatPercent(point.severeErrorRate)}</strong>
                </div>
              </div>
            ))}
          </div>

          {scoringIsSynthetic ? (
            <p className="lab-reading">
              这 {scoringBenchmark.design.sampleCount} 条记录是刻意构造的合成
              数据，只证明校验、评阅一致性计算、单遍与双遍评分对照、分组重采样
              和证据可靠性检查能够稳定运行；它们不构成模型效果证据。
              当前状态为“{releaseStatusLabel(scoringReleaseStatus)}”，直到完成 200
              条经同意、匿名化、双人盲标的真实回答。
            </p>
          ) : (
            <p className="lab-reading">
              当前验收状态为“{releaseStatusLabel(scoringReleaseStatus)}”。
              {scoringBenchmark.releaseGate.claimBoundary}
            </p>
          )}
        </article>
      </section>

      <section className="lab-grid">
        <article className="lab-card lab-card-wide">
          <div className="section-heading">
            <div>
              <p className="card-index">05 / 语音验收</p>
              <h2>语音验收：转写准确性与会话恢复</h2>
            </div>
            <span className="legend">
              合成数据流程检查 · {voiceBenchmark.dataset.sampleCount} 条记录
            </span>
          </div>

          <p>字符错误率越低越好。耗时的 95% 分位表示约 95% 的记录不超过该时长，用于观察较慢的连接。</p>
          <p className="table-hint">左右滚动查看完整表格</p>
          <div className="benchmark-table" role="table" tabIndex={0} aria-label="语音验收数据，窄屏可横向滚动">
            <div className="benchmark-row benchmark-head" role="row">
              <span role="columnheader">检查项</span>
              <span role="columnheader">合成数据结果</span>
              <span role="columnheader">真实门槛</span>
              <span role="columnheader">当前状态</span>
            </div>
            <div className="benchmark-row" role="row">
              <strong role="cell">中文字符错误率</strong>
              <span role="cell">{formatPercent(voiceBenchmark.metrics.characterErrorRate)}</span>
              <span role="cell">≤ 15%</span>
              <span role="cell">{releaseStatusLabel(voiceReleaseStatus)}</span>
            </div>
            <div className="benchmark-row" role="row">
              <strong role="cell">专业术语准确率</strong>
              <span role="cell">{formatPercent(voiceBenchmark.metrics.domainTermAccuracy)}</span>
              <span role="cell">≥ 90%</span>
              <span role="cell">仅验证计算链路</span>
            </div>
            <div className="benchmark-row" role="row">
              <strong role="cell">检查点恢复正确率</strong>
              <span role="cell">{formatPercent(voiceBenchmark.metrics.checkpointRestoreRate)}</span>
              <span role="cell">100%</span>
              <span role="cell">需 30 次真实会话</span>
            </div>
            <div className="benchmark-row" role="row">
              <strong role="cell">连接耗时（95% 分位）</strong>
              <span role="cell">{(voiceBenchmark.metrics.connectionP95Ms / 1_000).toFixed(2)} s</span>
              <span role="cell">≤ 4 s</span>
              <span role="cell">合成时延</span>
            </div>
          </div>

          <p className="lab-reading">
            这里的数值来自刻意构造的合成转写，只证明字符编辑距离、术语匹配、
            p95、恢复率和重复提交门禁能够确定性运行。当前验收状态为“{releaseStatusLabel(voiceReleaseStatus)}”；
            完成 30 次经同意的中文会话前，不把这些数值描述成真实语音质量。
          </p>
        </article>
      </section>

      <section className="lab-next">
        <p className="card-index">下一步 · 真人验证</p>
        <h2>
          {scoringReleaseStatus === "NOT_READY"
            ? "下一步：评分小规模试评与中文语音实测"
            : `评分验收：${releaseStatusLabel(scoringReleaseStatus)}`}
        </h2>
        {scoringReleaseStatus === "NOT_READY" ? (
          <p>
            评分小规模试评用于修订标注规范；语音验收会报告字符错误率、术语准确率、
            检查点恢复率和 p95 延迟。评分协议冻结后只在锁定测试集上报告；
            两类实验都必须报告样本量，不能用合成夹具替代真实结论。
          </p>
        ) : scoringReleaseStatus === "PASS" ? (
          <p>
            工程一致性门禁已经通过；仍需单独审计同意、匿名化和锁定测试只运行一次的流程，
            且不得把评分一致性解释为招聘效度。
          </p>
        ) : (
          <p>
            正式数据尚未通过门禁。应优先检查失败项和最大误差案例，不发布评分器有效性结论。
          </p>
        )}
        <Link className="primary-button link-button" href="/">
          开始一次面试练习 <span>→</span>
        </Link>
      </section>
    </main>
  );
}
