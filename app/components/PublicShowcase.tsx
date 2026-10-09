"use client";

import { useState } from "react";
import Link from "next/link";
import demo from "@/content/agent-demo.json";

const weakTurn = demo.trace[0];
const verificationTurn = demo.trace[1];
const firstAdaptive = demo.audit.steps.find((step) => step.questionType === "adaptive")!;
const acceptedTurn = demo.trace[firstAdaptive.sequenceNumber - 2];
const replayComplete = Object.values(demo.audit.invariants).every(Boolean);

const stages = [
  { label: "证据不足", state: "ANSWER" },
  { label: "限定追问", state: "VERIFY" },
  { label: "保留能力状态", state: "ABSTAIN" },
  { label: "更新与选题", state: "ACCEPT" },
  { label: "决策回放", state: "REPLAY" },
] as const;

const stageCopy = [
  {
    eyebrow: "第 1 步 · 检查回答依据",
    title: "从一条缺少关键依据的回答开始",
    question: weakTurn.questionText,
    answer: weakTurn.answer,
    action: "查看系统如何核实",
  },
  {
    eyebrow: "第 2 步 · 限定追问",
    title: "用一次限定追问，核实缺失的关键依据",
    question: verificationTurn.questionText,
    answer: verificationTurn.answer,
    action: "查看追问后的判断",
  },
  {
    eyebrow: "第 3 步 · 保留能力状态",
    title: "追问后依据仍不足，能力状态保持不变",
    question: verificationTurn.questionText,
    answer: verificationTurn.answer,
    action: "查看依据完整的回答",
  },
  {
    eyebrow: "第 4 步 · 更新与选题",
    title: "依据可靠回答更新估计，比较下一题的价值",
    question: acceptedTurn.questionText,
    answer: acceptedTurn.answer,
    action: "查看完整决策回放",
  },
  {
    eyebrow: "第 5 步 · 决策回放",
    title: "重建选题路径，核对每次决策是否一致",
    question: "这不是又一个只会生成问题和总分的 AI 面试官吗？",
    answer:
      "区别在于决策可重放：系统保存后验、候选题效用分解、可靠性动作和检查点，通过策略重放检查选题一致性，指纹用于比较同一版本的决策轨迹。",
    action: "重新体验",
  },
] as const;

export function PublicShowcase() {
  const [stage, setStage] = useState(0);
  const current = stageCopy[stage];
  const isFinal = stage === stageCopy.length - 1;

  function advance() {
    setStage((value) => (value >= stageCopy.length - 1 ? 0 : value + 1));
  }

  return (
    <main id="main-content" tabIndex={-1} className="showcase-shell">
      <header className="showcase-header">
        <a className="brand" href="/showcase" aria-label="StatInterview 演示首页">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span>
            <strong>StatInterview</strong>
            <small>项目交互演示</small>
          </span>
        </a>
        <div className="showcase-header-actions">
          <span className="showcase-safe-badge">只读 · 合成数据 · 不保存</span>
          <Link href="/">返回练习</Link>
          <a href="/lab">实验与方法</a>
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
          <p className="eyebrow">五步了解决策过程</p>
          <h1>看 Agent 如何核实依据，再选择下一题。</h1>
          <p>
            依次体验追问核实、保留能力状态、更新估计与自适应选题。页面使用预先构造的合成回答回放决策，
            不调用模型、不写数据库、不收集候选人信息。
          </p>
        </div>
        <div className="showcase-proof">
          <div>
            <strong>{demo.audit.summary.matchingSelections} / {demo.audit.summary.replayedTurns}</strong>
            <span>本次合成回放 · 决策一致</span>
          </div>
          <div>
            <strong>{demo.audit.summary.adaptiveDecisions}</strong>
            <span>本次演示 · 自适应选题</span>
          </div>
        </div>
      </section>

      <section className="showcase-workspace">
        <aside className="showcase-steps" aria-label="演示步骤">
          <p>决策过程</p>
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
            <p>回答与分数是预先构造的合成数据。选题、能力状态和回放检查由实际策略代码计算；这只展示程序行为。</p>
          </div>
        </aside>

        <div className="showcase-stage">
          <div className="showcase-stage-heading">
            <div>
              <p>{current.eyebrow}</p>
              <h2>{current.title}</h2>
            </div>
            <span role="status" aria-label={`演示第 ${stage + 1} 步，共 ${stageCopy.length} 步`}>{stage + 1} / {stageCopy.length}</span>
          </div>

          {isFinal ? (
            <ReplayPanel />
          ) : (
            <>
              <article className="showcase-question">
                <span>面试问题</span>
                <h3>{current.question}</h3>
              </article>
              <article className="showcase-answer">
                <div>
                  <span>演示回答 · 合成数据</span>
                  <small>保留原文</small>
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
        <div><span>可靠性判断 · VERIFY</span><strong>需要核实</strong></div>
        <p>{weakTurn.reason}</p>
        <span className="showcase-outcome">暂不更新能力估计</span>
      </div>
    );
  }
  if (stage === 1) {
    return (
      <div className="showcase-decision abstain">
        <div><span>可靠性判断 · ABSTAIN</span><strong>依据仍不足</strong></div>
        <p>{verificationTurn.reason}</p>
        <span className="showcase-outcome">能力状态保持不变</span>
      </div>
    );
  }
  if (stage === 2) {
    return (
      <div className="showcase-ability-panel">
        <Ability label={verificationTurn.skillLabel} before={verificationTurn.before.mean} after={verificationTurn.after.mean} note="依据不足，维持原有估计" />
        <p>追问后仍缺少依据，能力均值和不确定性均保持不变。</p>
      </div>
    );
  }
  return (
    <div className="showcase-adaptive-grid">
      <div className="showcase-ability-panel">
        <Ability label={acceptedTurn.skillLabel} before={acceptedTurn.before.mean} after={acceptedTurn.after.mean} note="合成证据已接受" />
        <p>估计不确定性（越低越确定）：{acceptedTurn.before.uncertainty.toFixed(3)} → {acceptedTurn.after.uncertainty.toFixed(3)}</p>
      </div>
      <div className="showcase-ranking">
        <span>候选题排序 · 综合选题价值</span>
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
      <small>能力估计：{before.toFixed(3)} → {after.toFixed(3)}（内部尺度 −3 至 3）</small>
    </div>
  );
}

function ReplayPanel() {
  return (
    <div className="showcase-replay">
      <div className="showcase-replay-status">
        <span>决策回放检查</span>
        <strong>{demo.audit.summary.matchingSelections} / {demo.audit.summary.replayedTurns} 决策一致</strong>
        <p>按相同的合成回答重新运行策略，核对能否得到一致的选题路径。此示例在内存中运行。</p>
      </div>
      <div className="showcase-replay-grid">
        <article><span>验证追问</span><strong>{demo.audit.summary.verificationDecisions}</strong><small>核实关键依据</small></article>
        <article><span>拒绝更新</span><strong>{demo.trace.filter((turn) => turn.action === "ABSTAIN").length}</strong><small>依据不足时保留估计</small></article>
        <article><span>自适应决策</span><strong>{demo.audit.summary.adaptiveDecisions}</strong><small>已核对选题路径</small></article>
        <article><span>一致性检查</span><strong>{Object.values(demo.audit.invariants).filter(Boolean).length} / {Object.keys(demo.audit.invariants).length}</strong><small>本次合成回放</small></article>
      </div>
      <details className="presentation-details">
        <summary>查看轨迹指纹与技术说明</summary>
        <div className="showcase-fingerprint">
          <span>轨迹指纹 · SHA-256</span>
          <code title={demo.fingerprint}>{demo.fingerprint.slice(0, 24)}…</code>
          <strong>{replayComplete ? "✓ 一致性检查通过" : "一致性检查未通过"}</strong>
        </div>
        <p>轨迹指纹用于比较同一策略的决策记录；它不是数字签名。选题变化仍需结合回放检查判断。</p>
      </details>
      <p className="showcase-replay-note">
        本页展示当前策略的合成回放，用于检查决策一致性，不衡量真实模型评分准确性。
        替换为另一道题库内合法题目：{demo.tamperCheck.detected ? "已检测到策略偏离" : "未检测到偏离"}。真人评分准确性与训练收益仍需独立验证。
      </p>
    </div>
  );
}
