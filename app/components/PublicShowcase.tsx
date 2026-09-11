"use client";

import { useState } from "react";
import demo from "@/content/agent-demo.json";

const weakTurn = demo.trace[0];
const verificationTurn = demo.trace[1];
const firstAdaptive = demo.audit.steps.find((step) => step.questionType === "adaptive")!;
const acceptedTurn = demo.trace[firstAdaptive.sequenceNumber - 2];
const replayComplete = Object.values(demo.audit.invariants).every(Boolean);

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
    question: weakTurn.questionText,
    answer: weakTurn.answer,
    action: "提交合成弱回答",
  },
  {
    eyebrow: "STEP 2 · VERIFY",
    title: "Agent 不直接给低分，而是提出一次有边界的追问",
    question: verificationTurn.questionText,
    answer: verificationTurn.answer,
    action: "提交限定追问回答",
  },
  {
    eyebrow: "STEP 3 · ABSTAIN",
    title: "追问后仍无证据，系统拒绝更新能力状态",
    question: verificationTurn.questionText,
    answer: verificationTurn.answer,
    action: "载入一条完整证据回答",
  },
  {
    eyebrow: "STEP 4 · ACCEPT + ADAPT",
    title: "可靠证据更新后验，下一题由信息价值决定",
    question: acceptedTurn.questionText,
    answer: acceptedTurn.answer,
    action: "查看完整决策回放",
  },
  {
    eyebrow: "FINAL · REPLAY",
    title: "最终结论可以回到每道题、每条证据和每次选择",
    question: "这不是又一个只会生成问题和总分的 AI 面试官吗？",
    answer:
      "区别在于决策可重放：系统保存后验、候选题效用分解、可靠性动作和检查点，通过策略重放检查选题一致性，指纹用于比较同一版本的决策轨迹。",
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
            <p>回答与分数为合成夹具；选题、能力状态、回放与指纹由同一版本的策略代码计算，不代表真人测评效果。</p>
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
        <p>{weakTurn.reason}</p>
        <code>posterior_update = blocked</code>
      </div>
    );
  }
  if (stage === 1) {
    return (
      <div className="showcase-decision abstain">
        <div><span>可靠性动作</span><strong>ABSTAIN</strong></div>
        <p>{verificationTurn.reason}</p>
        <code>posterior(t+1) = posterior(t)</code>
      </div>
    );
  }
  if (stage === 2) {
    return (
      <div className="showcase-ability-panel">
        <Ability label={verificationTurn.skillLabel} before={verificationTurn.before.mean} after={verificationTurn.after.mean} note="证据不足，保留先验" />
        <p>追问后仍缺少依据，能力均值和不确定性均保持不变。</p>
      </div>
    );
  }
  return (
    <div className="showcase-adaptive-grid">
      <div className="showcase-ability-panel">
        <Ability label={acceptedTurn.skillLabel} before={acceptedTurn.before.mean} after={acceptedTurn.after.mean} note="合成证据已接受" />
        <p>后验不确定性：{acceptedTurn.before.uncertainty.toFixed(3)} → {acceptedTurn.after.uncertainty.toFixed(3)}</p>
      </div>
      <div className="showcase-ranking">
        <span>NEXT QUESTION UTILITY</span>
        <ol>
          {firstAdaptive.ranking.map((candidate) => (
            <li key={candidate.questionId}>
              <strong>{candidate.questionText}</strong>
              <em>{candidate.utility.toFixed(3)}</em>
            </li>
          ))}
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
        <i style={{ width: `${Math.max(0, Math.min(100, ((after + 3) / 6) * 100))}%` }} />
      </div>
      <small>能力均值 θ：{before.toFixed(3)} → {after.toFixed(3)}（范围 −3 至 3）</small>
    </div>
  );
}

function ReplayPanel({ relativeMaeReduction }: { relativeMaeReduction: number }) {
  return (
    <div className="showcase-replay">
      <div className="showcase-replay-status">
        <span>POLICY REPLAY</span>
        <strong>{demo.audit.summary.matchingSelections} / {demo.audit.summary.replayedTurns} 决策一致</strong>
        <p>将合成回答按存储记录格式在内存中重放，选题路径可确定性重建。此示例不连接数据库。</p>
      </div>
      <div className="showcase-replay-grid">
        <article><span>验证追问</span><strong>{demo.audit.summary.verificationDecisions}</strong><small>bounded</small></article>
        <article><span>拒绝更新</span><strong>{demo.trace.filter((turn) => turn.action === "ABSTAIN").length}</strong><small>abstained</small></article>
        <article><span>自适应决策</span><strong>{demo.audit.summary.adaptiveDecisions}</strong><small>replayed</small></article>
        <article><span>模拟 MAE</span><strong>-{relativeMaeReduction.toFixed(2)}%</strong><small>vs fixed</small></article>
      </div>
      <div className="showcase-fingerprint">
        <span>SHA-256 POLICY FINGERPRINT</span>
        <code title={demo.fingerprint}>{demo.fingerprint.slice(0, 24)}…</code>
        <strong>{replayComplete ? "✓ invariant checks passed" : "Replay checks failed"}</strong>
      </div>
      <p className="showcase-replay-note">
        替换为另一道题库内合法题目：{demo.tamperCheck.detected ? "已检测到策略偏离" : "未检测到偏离"}。指纹不是数字签名；合成回放不证明招聘有效性或真人学习收益。
      </p>
    </div>
  );
}
