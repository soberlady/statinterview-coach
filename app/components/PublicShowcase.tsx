"use client";

import { useState } from "react";

type PublicShowcaseProps = {
  relativeMaeReduction: number;
  simulatedCandidates: number;
};

const stages = [
  { label: "证据不足", state: "ANSWER" },
  { label: "限定追问", state: "VERIFY" },
  { label: "拒绝评分", state: "ABSTAIN" },
  { label: "更新与选题", state: "ACCEPT" },
  { label: "决策回放", state: "REPLAY" },
] as const;

const stageCopy = [
  {
    eyebrow: "STEP 1 · RAW EVIDENCE",
    title: "先故意提交一条证据不足的回答",
    question:
      "一次 A/B 实验的核心指标显著上涨，你会如何判断是否可以全量发布？",
    answer:
      "我会先看最终指标有没有上涨；如果上涨就认为方案有效，暂时不检查样本偏差、指标口径或其他条件。",
    action: "提交合成弱回答",
  },
  {
    eyebrow: "STEP 2 · VERIFY",
    title: "Agent 不直接给低分，而是提出一次有边界的追问",
    question:
      "请只补充说明：显著上涨之外，你至少会检查哪两项发布条件？",
    answer:
      "我暂时只能重复上一轮结论，没有新的数据、计算过程或可核验的判断标准可以补充。",
    action: "提交限定追问回答",
  },
  {
    eyebrow: "STEP 3 · ABSTAIN",
    title: "追问后仍无证据，系统拒绝更新能力状态",
    question: "为什么不把这次回答直接记为“能力较差”？",
    answer:
      "低质量转写、题意误解和真实知识缺口可能产生相同表象。证据不足时保留先验，比制造一个自信的错误分数更安全。",
    action: "载入一条完整证据回答",
  },
  {
    eyebrow: "STEP 4 · ACCEPT + ADAPT",
    title: "可靠证据更新后验，下一题由信息价值决定",
    question:
      "面对 SQL 权重更高的岗位，有限题量应该优先测量哪个能力缺口？",
    answer:
      "回答覆盖口径校验、随机化检查、置信区间、护栏指标和发布阈值，证据可逐句定位，因此允许更新能力后验。",
    action: "查看完整决策回放",
  },
  {
    eyebrow: "FINAL · REPLAY",
    title: "最终结论可以回到每道题、每条证据和每次选择",
    question: "这不是又一个只会生成问题和总分的 AI 面试官吗？",
    answer:
      "区别在于决策可重放：系统保存后验、候选题效用分解、可靠性动作和检查点，并用指纹验证报告路径没有被篡改。",
    action: "重新体验",
  },
] as const;

export function PublicShowcase({
  relativeMaeReduction,
  simulatedCandidates,
}: PublicShowcaseProps) {
  const [stage, setStage] = useState(0);
  const current = stageCopy[stage];
  const isFinal = stage === stageCopy.length - 1;

  function advance() {
    setStage((value) => (value >= stageCopy.length - 1 ? 0 : value + 1));
  }

  return (
    <main className="showcase-shell">
      <header className="showcase-header">
        <a className="brand" href="/showcase" aria-label="StatInterview 演示首页">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span>
            <strong>StatInterview</strong>
            <small>Portfolio demo</small>
          </span>
        </a>
        <div className="showcase-header-actions">
          <span className="showcase-safe-badge">只读 · 合成数据 · 不保存</span>
          <a href="/lab">实验结果</a>
          <a
            href="https://github.com/soberlady/statinterview-coach"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
        </div>
      </header>

      <section className="showcase-intro">
        <div>
          <p className="eyebrow">3-MINUTE INTERACTIVE DEMO</p>
          <h1>看 Agent 如何在证据不足时，选择不相信自己。</h1>
          <p>
            依次体验验证、拒绝评分、贝叶斯更新与自适应选题。此页面只重放确定性合成场景，
            不调用模型、不写数据库、不收集候选人信息。
          </p>
        </div>
        <div className="showcase-proof">
          <div>
            <strong>{simulatedCandidates.toLocaleString("zh-CN")}</strong>
            <span>合成候选人对照实验</span>
          </div>
          <div>
            <strong>{relativeMaeReduction.toFixed(2)}%</strong>
            <span>相对固定题序 MAE 降幅</span>
          </div>
        </div>
      </section>

      <section className="showcase-workspace" aria-live="polite">
        <aside className="showcase-steps" aria-label="演示步骤">
          <p>AGENT TRACE</p>
          {stages.map((item, index) => (
            <button
              key={item.state}
              type="button"
              className={index === stage ? "active" : index < stage ? "done" : ""}
              onClick={() => setStage(index)}
              aria-current={index === stage ? "step" : undefined}
            >
              <span>{index < stage ? "✓" : index + 1}</span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.state}</small>
              </span>
            </button>
          ))}
          <div className="showcase-boundary">
            <strong>演示边界</strong>
            <p>展示真实状态机设计，数值和回答为固定夹具，不代表真人测评效果。</p>
          </div>
        </aside>

        <div className="showcase-stage">
          <div className="showcase-stage-heading">
            <div>
              <p>{current.eyebrow}</p>
              <h2>{current.title}</h2>
            </div>
            <span>{stage + 1} / {stageCopy.length}</span>
          </div>

          {isFinal ? (
            <ReplayPanel relativeMaeReduction={relativeMaeReduction} />
          ) : (
            <>
              <article className="showcase-question">
                <span>面试问题</span>
                <h3>{current.question}</h3>
              </article>
              <article className="showcase-answer">
                <div>
                  <span>合成候选人回答</span>
                  <small>verbatim evidence</small>
                </div>
                <p>{current.answer}</p>
              </article>
              <DecisionPanel stage={stage} />
            </>
          )}

          <div className="showcase-controls">
            <button type="button" onClick={advance} className="primary-button">
              {current.action}<span aria-hidden="true">→</span>
            </button>
            <span>键盘和手机均可操作 · 无需登录</span>
          </div>
        </div>
      </section>

      <footer className="showcase-footer">
        <p>StatInterview Coach · 面试训练项目，不用于自动化招聘决策</p>
        <p>
          <a href="/lab">查看实验边界</a> ·{" "}
          <a href="https://github.com/soberlady/statinterview-coach">查看完整源码</a>
        </p>
      </footer>
    </main>
  );
}

function DecisionPanel({ stage }: { stage: number }) {
  if (stage === 0) {
    return (
      <div className="showcase-decision verify">
        <div><span>可靠性动作</span><strong>VERIFY</strong></div>
        <p>仅提到“指标上涨”，缺少随机化、口径、区间与护栏证据。允许一次批准题库内的限定追问。</p>
        <code>posterior_update = blocked</code>
      </div>
    );
  }
  if (stage === 1) {
    return (
      <div className="showcase-decision abstain">
        <div><span>可靠性动作</span><strong>ABSTAIN</strong></div>
        <p>验证预算已经使用，仍然没有新增可核验证据。保留上一时刻后验，不制造能力结论。</p>
        <code>posterior(t+1) = posterior(t)</code>
      </div>
    );
  }
  if (stage === 2) {
    return (
      <div className="showcase-ability-panel">
        <Ability label="实验与因果" before={50} after={50} note="拒绝更新" />
        <Ability label="SQL 与 Python" before={50} after={50} note="等待证据" />
      </div>
    );
  }
  return (
    <div className="showcase-adaptive-grid">
      <div className="showcase-ability-panel">
        <Ability label="实验与因果" before={50} after={68} note="证据已接受" />
        <Ability label="SQL 与 Python" before={50} after={57} note="不确定性最高" />
      </div>
      <div className="showcase-ranking">
        <span>NEXT QUESTION UTILITY</span>
        <ol>
          <li><strong>SQL 口径与重复行</strong><em>0.842</em></li>
          <li><strong>实验护栏指标</strong><em>0.716</em></li>
          <li><strong>分类阈值选择</strong><em>0.503</em></li>
        </ol>
      </div>
    </div>
  );
}

function Ability({
  label,
  before,
  after,
  note,
}: {
  label: string;
  before: number;
  after: number;
  note: string;
}) {
  return (
    <div className="showcase-ability">
      <div><strong>{label}</strong><span>{note}</span></div>
      <div className="showcase-ability-track">
        <i style={{ width: `${after}%` }} />
      </div>
      <small>{before} → {after}</small>
    </div>
  );
}

function ReplayPanel({ relativeMaeReduction }: { relativeMaeReduction: number }) {
  return (
    <div className="showcase-replay">
      <div className="showcase-replay-status">
        <span>POLICY REPLAY</span>
        <strong>7 / 7 决策一致</strong>
        <p>问题顺序、可靠性动作和能力更新均能从持久化证据确定性重建。</p>
      </div>
      <div className="showcase-replay-grid">
        <article><span>验证追问</span><strong>1</strong><small>bounded</small></article>
        <article><span>拒绝更新</span><strong>1</strong><small>abstained</small></article>
        <article><span>自适应决策</span><strong>2</strong><small>replayed</small></article>
        <article><span>模拟 MAE</span><strong>-{relativeMaeReduction.toFixed(2)}%</strong><small>vs fixed</small></article>
      </div>
      <div className="showcase-fingerprint">
        <span>SHA-256 POLICY FINGERPRINT</span>
        <code>86f57c4473a14644…</code>
        <strong>✓ invariant checks passed</strong>
      </div>
      <p className="showcase-replay-note">
        结论边界：该结果验证工程机制与模拟假设，不证明招聘有效性或真人学习收益。
      </p>
    </div>
  );
}
