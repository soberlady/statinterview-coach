import Link from "next/link";
import { InterviewSetupForm } from "./components/InterviewSetupForm";
import benchmark from "@/content/policy-benchmark.json";

export default function Home() {
  return (
    <main className="site-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="StatInterview 首页">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <span>
            <strong>StatInterview</strong>
            <small>Adaptive interview coach</small>
          </span>
        </Link>
        <nav className="topnav" aria-label="主导航">
          <a href="#method">方法</a>
          <a href="#trust">可信评测</a>
          <Link href="/lab">策略实验</Link>
          <span className="status-pill">
            <span aria-hidden="true" />
            Public beta
          </span>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">为数据分析实习面试而设计</p>
          <h1>
            不凑题数，
            <br />
            找到真正的<span>能力缺口。</span>
          </h1>
          <p className="hero-description">
            固定锚点保证可比较，自适应问题减少无效练习。证据不足时，
            Agent 会继续验证，而不是武断地给你一个分数。
          </p>
          <div className="hero-proof">
            <div>
              <strong>4</strong>
              <span>核心能力维度</span>
            </div>
            <div>
              <strong>15–20</strong>
              <span>分钟一次诊断</span>
            </div>
            <div>
              <strong>0</strong>
              <span>表情与颜值评分</span>
            </div>
          </div>
        </div>

        <InterviewSetupForm />
      </section>

      <section className="method-grid" id="method">
        <article className="method-card method-card-featured">
          <p className="card-index">01 / ADAPT</p>
          <h2>下一道题，由信息价值决定</h2>
          <p>
            系统维护统计、实验、工程和业务四项能力状态，优先询问最能减少当前不确定性的问题。
          </p>
          <div className="uncertainty-demo" aria-label="能力状态示意">
            {[
              ["统计与机器学习", 74, "较确定"],
              ["实验与因果", 48, "待验证"],
              ["SQL 与 Python", 67, "中等"],
              ["业务分析", 39, "待验证"],
            ].map(([label, value, state]) => (
              <div className="ability-row" key={label}>
                <div>
                  <span>{label}</span>
                  <small>{state}</small>
                </div>
                <div className="ability-track">
                  <span style={{ width: `${value}%` }} />
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="method-card" id="trust">
          <p className="card-index">02 / VERIFY</p>
          <h2>不知道，就是一种有效答案</h2>
          <p>
            评分器提取原文证据并逐项匹配量表。证据不足、转写异常或评审分歧时，系统会追问或拒绝评分。
          </p>
          <div className="decision-card">
            <span className="decision-label">可靠性</span>
            <strong>LOW · 需要验证</strong>
            <p>尚未说明多重检验对假阳性率的影响。</p>
          </div>
        </article>

        <article className="method-card">
          <p className="card-index">03 / IMPROVE</p>
          <h2>记录证据变化，不只保存历史分数</h2>
          <p>
            下一次练习优先回测薄弱或长期未验证的知识点，并展示回答前后的证据差异。
          </p>
          <div className="timeline-mini">
            <span>首次诊断</span>
            <i />
            <span>专项训练</span>
            <i />
            <span>能力回测</span>
          </div>
        </article>
      </section>

      <section className="evidence-strip" aria-labelledby="evidence-title">
        <div>
          <p className="eyebrow">POLICY EVIDENCE · SYNTHETIC OFFLINE</p>
          <h2 id="evidence-title">创新不是一句“自适应”，而是可复现的对照结果。</h2>
          <p>
            在相同六题预算下，4,000 个合成候选人的岗位加权能力估计 MAE
            相对固定题序下降{" "}
            {Math.abs(
              benchmark.adaptiveSelection.comparisons.adaptive_vs_fixed
                .relative_mae_change_pct,
            ).toFixed(2)}
            %。均衡岗位上差异很小，收益主要来自岗位能力权重不均时的定向测量。
          </p>
        </div>
        <div className="evidence-numbers">
          <div>
            <strong>
              {
                benchmark.adaptiveSelection.design
                  .total_simulated_candidates
              }
            </strong>
            <span>合成候选人</span>
          </div>
          <div>
            <strong>
              {(
                benchmark.adaptiveSelection.aggregate.adaptive
                  .weighted_90pct_interval_coverage * 100
              ).toFixed(1)}
              %
            </strong>
            <span>90% 区间覆盖率</span>
          </div>
          <Link className="secondary-button" href="/lab">
            查看实验设计与边界
          </Link>
        </div>
      </section>

      <footer className="footer">
        <p>StatInterview Coach · 训练用途，不用于自动化招聘决策</p>
        <p>
          <Link href="/lab">查看可复现实验</Link> ·
          评分只基于回答内容，不分析面部、眼神或情绪。
        </p>
      </footer>
    </main>
  );
}
