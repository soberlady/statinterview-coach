import type { Metadata } from "next";
import Link from "next/link";
import benchmark from "@/content/policy-benchmark.json";

export const metadata: Metadata = {
  title: "策略实验",
  description: "自适应选题与可靠性防护的可复现离线实验。",
};

const PROFILE_LABELS: Record<string, string> = {
  balanced: "均衡型岗位",
  growth_analytics: "增长分析",
  experiment_analysis: "实验分析",
  data_engineering: "数据工程分析",
};

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

  return (
    <main className="lab-shell">
      <header className="report-header">
        <Link className="brand compact" href="/">
          <span className="brand-mark">S</span>
          <strong>StatInterview</strong>
        </Link>
        <span>Policy Lab · seed {benchmark.adaptiveSelection.design.seed}</span>
        <Link className="quiet-button" href="/">
          返回产品
        </Link>
      </header>

      <section className="lab-hero">
        <div>
          <p className="eyebrow">REPRODUCIBLE POLICY EVALUATION</p>
          <h1>不只展示 Agent，验证它为什么这样决策。</h1>
          <p>
            我们固定四道锚点题，在相同的六题预算下，对比自适应、固定题序与随机合法题序。
            所有结果由确定性脚本生成，并明确限制在仿真假设内。
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

      <section className="lab-kpis" aria-label="实验核心结果">
        <article>
          <span>自适应 vs 固定题序</span>
          <strong>
            {Math.abs(comparison.relative_mae_change_pct).toFixed(2)}%
          </strong>
          <p>岗位加权能力估计 MAE 下降</p>
        </article>
        <article>
          <span>配对 95% 区间</span>
          <strong>
            [{comparison.paired_95pct_ci[0].toFixed(3)},{" "}
            {comparison.paired_95pct_ci[1].toFixed(3)}]
          </strong>
          <p>MAE 绝对差，区间未跨 0</p>
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
          <p>verify / abstain 降低对 oracle 的偏离</p>
        </article>
      </section>

      <section className="lab-grid">
        <article className="lab-card lab-card-wide">
          <div className="section-heading">
            <div>
              <p className="card-index">01 / SELECTION ABLATION</p>
              <h2>同样六题，问题分配给谁更重要</h2>
            </div>
            <span className="legend">
              加权 MAE 越低越好 · n=
              {benchmark.adaptiveSelection.design.total_simulated_candidates}
            </span>
          </div>

          <div className="benchmark-table">
            <div className="benchmark-row benchmark-head">
              <span>策略</span>
              <span>加权 MAE</span>
              <span>加权 RMSE</span>
              <span>选中岗位权重</span>
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
                >
                  <strong>{label as string}</strong>
                  <span>{typed.weighted_mae.toFixed(3)}</span>
                  <span>{typed.weighted_rmse.toFixed(3)}</span>
                  <span>{typed.mean_selected_job_weight.toFixed(3)}</span>
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
                    ["固定", values.fixed.weighted_mae, "fixed"],
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
            Agent 把有限的两道追问题分配给更相关的能力维度。这说明当前创新点是
            “预算约束下的岗位定向测量”，不是宣称万能的智能出题。
          </p>
        </article>

        <article className="lab-card">
          <p className="card-index">02 / RELIABILITY FAULT</p>
          <h2>检测到证据损坏后，不强行更新能力</h2>
          <div className="fault-comparison">
            <div>
              <span>总是接受</span>
              <strong>
                {guardrail.always_accept.mean_absolute_deviation_from_oracle.toFixed(
                  3,
                )}
              </strong>
              <small>oracle 偏离</small>
            </div>
            <span>→</span>
            <div className="safe">
              <span>验证 / 弃权</span>
              <strong>
                {guardrail.verify_or_abstain.mean_absolute_deviation_from_oracle.toFixed(
                  3,
                )}
              </strong>
              <small>oracle 偏离</small>
            </div>
          </div>
          <p>
            故障注入把最终答案反转，并假设完整性检查已经发现异常。追问与原答案冲突时，
            策略保留先验、不采信任一答案。本实验只评估“发现以后怎么做”，不代表已测得故障检测召回率。
          </p>
        </article>

        <article className="lab-card">
          <p className="card-index">03 / REPRODUCE</p>
          <h2>一条命令复现实验</h2>
          <pre>
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

      <section className="lab-next">
        <p className="card-index">NEXT EVIDENCE</p>
        <h2>下一步不是再加功能，而是引入真实答案。</h2>
        <p>
          计划招募 10–20 名同学，收集匿名回答，由两名标注者盲评“追问是否更有诊断价值”，
          同时报告一致性、样本量和失败案例。上线前不把离线仿真写成真实用户收益。
        </p>
        <Link className="primary-button link-button" href="/">
          亲自跑一次文本诊断 <span>→</span>
        </Link>
      </section>
    </main>
  );
}
