import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { InterviewTurn, SkillState } from "../db/schema";
import {
  selectNextQuestion, updateAbility, SELECTION_POLICY_VERSION,
  TARGET_SUBSTANTIVE_TURNS,
} from "../app/lib/agent-policy";
import { replayInterviewPolicy, fingerprintPolicyAudit } from "../app/lib/decision-audit";
import {
  buildGuidedDemoPayload, evaluateGuidedDemoAnswer,
  GUIDED_DEMO_REQUEST, GUIDED_DEMO_VERSION,
} from "../app/lib/guided-demo";
import { getInterviewQuestion, listQuestions, SKILL_LABELS } from "../app/lib/question-bank";

/** Runs the production edge policy with labeled synthetic answers, without adapters. */
export async function buildAgentDemo() {
  const timestamp = "synthetic-demo";
  const interview = { id: "synthetic-agent-demo", ...GUIDED_DEMO_REQUEST };
  let states: SkillState[] = Object.keys(SKILL_LABELS).map((skill) => ({
    id: `demo_${skill}`, interviewId: interview.id, skill,
    posteriorMean: 0, uncertainty: 1, posterior: "[]",
    supportingEvidence: "[]", commonErrors: "[]", sourceTurnCount: 0,
    createdAt: timestamp, updatedAt: timestamp,
  }));
  const turns: InterviewTurn[] = [];
  const trace = [];
  let verificationCount = 0;
  // Fail closed if a policy regression does not terminate within its budget.
  for (let index = 0; index < TARGET_SUBSTANTIVE_TURNS + 3; index += 1) {
    const decision = selectNextQuestion({
      interview: { ...interview, verificationCount }, turns, skillStates: states,
    });
    if (decision.action === "COMPLETE") break;
    const question = decision.nextQuestion;
    assert.ok(question, "Nonterminal policy must select an approved question");
    const payload = buildGuidedDemoPayload({
      question, completedTurns: turns.length,
      substantiveTurns: turns.filter((turn) => turn.questionType !== "verification").length,
    });
    const answer = payload.answerOptions.find((option) => option.recommended)?.answer;
    assert.ok(answer, "Scenario must have a recommended synthetic answer");
    const evaluation = evaluateGuidedDemoAnswer(question, answer);
    assert.equal(evaluation.evaluator, "DEMO_FIXTURE");
    assert.ok(evaluation.evidence.every((quote) => answer.includes(quote)));
    const turnId = `synthetic_turn_${index + 1}`;
    const previous = states.find((state) => state.skill === question.skill);
    assert.ok(previous);
    const updated = updateAbility(previous, question, evaluation, turnId);
    const stateUpdated = updated.sourceTurnCount > previous.sourceTurnCount;
    assert.equal(stateUpdated, evaluation.action === "ACCEPT");
    if (!stateUpdated) {
      assert.equal(updated.posteriorMean, previous.posteriorMean);
      assert.equal(updated.uncertainty, previous.uncertainty);
    }
    states = states.map((state) => state.id !== previous.id ? state : {
      ...state, posteriorMean: updated.posteriorMean, uncertainty: updated.uncertainty,
      posterior: JSON.stringify(updated.posterior),
      supportingEvidence: JSON.stringify(updated.supportingEvidence),
      commonErrors: JSON.stringify(updated.commonErrors), sourceTurnCount: updated.sourceTurnCount,
    });
    turns.push({
      id: turnId, interviewId: interview.id, sequenceNumber: index + 1,
      questionId: question.id, questionText: question.question, skill: question.skill,
      questionType: question.questionType, answerText: answer, scoringAnswerText: null,
      inputMode: "text", status: "completed", transcriptConfidence: null,
      evidence: JSON.stringify(evaluation.evidence), evaluation: JSON.stringify(evaluation),
      reliability: evaluation.reliability, startedAt: timestamp, completedAt: timestamp,
      createdAt: timestamp, updatedAt: timestamp,
    });
    trace.push({
      sequenceNumber: index + 1, questionId: question.id, questionText: question.question,
      questionType: question.questionType, phase: decision.context?.selectionPhase ?? null,
      skill: question.skill, skillLabel: SKILL_LABELS[question.skill],
      answer, evaluator: evaluation.evaluator, action: evaluation.action,
      reliability: evaluation.reliability, evidence: evaluation.evidence,
      reason: evaluation.gaps[0], selectionReason: decision.reason,
      stateUpdated,
      before: { mean: previous.posteriorMean, uncertainty: previous.uncertainty },
      after: { mean: updated.posteriorMean, uncertainty: updated.uncertainty },
    });
    if (question.questionType === "verification") verificationCount += 1;
  }
  const audit = replayInterviewPolicy({ interview, turns });
  assert.ok(Object.values(audit.invariants).every(Boolean), "Demo must pass every replay invariant");
  assert.equal(audit.finalDecision.action, "COMPLETE");

  // Replace a selected adaptive question with a different approved bank entry.
  // This demonstrates selection validation, not merely a question allowlist.
  const tamperedIndex = turns.findIndex((turn) => turn.questionType === "adaptive");
  assert.ok(tamperedIndex >= 0);
  const askedIds = new Set(turns.map((turn) => turn.questionId));
  const source = listQuestions().find((question) => !question.isAnchor && !askedIds.has(question.id));
  assert.ok(source);
  const replacement = getInterviewQuestion(source.id);
  assert.ok(replacement);
  const tamperedTurns = turns.map((turn, index) => index !== tamperedIndex ? turn : {
    ...turn, questionId: replacement.id, questionText: replacement.question,
    skill: replacement.skill, questionType: replacement.questionType,
  });
  const tamperedAudit = replayInterviewPolicy({ interview, turns: tamperedTurns });
  assert.equal(tamperedAudit.invariants.allQuestionsApproved, true);
  assert.equal(tamperedAudit.steps[tamperedIndex].matchesPolicy, false);
  const fingerprint = await fingerprintPolicyAudit(audit);
  const tamperedFingerprint = await fingerprintPolicyAudit(tamperedAudit);
  assert.notEqual(fingerprint, tamperedFingerprint);

  return {
    version: "agent-demo-v1", synthetic: true as const,
    scenarioVersion: GUIDED_DEMO_VERSION, policyVersion: SELECTION_POLICY_VERSION,
    boundary: "Synthetic fixture scores; production TypeScript policy executed in memory. No model calls, database, audio or human-validity measurement. Fingerprint covers the policy trace, not a cryptographic signature of raw evidence.",
    interview, trace, audit, fingerprint,
    tamperCheck: {
      detected: !tamperedAudit.invariants.deterministicSelection,
      sequenceNumber: tamperedIndex + 1,
      expectedQuestionId: turns[tamperedIndex].questionId,
      replacementQuestionId: replacement.id,
      allQuestionsApproved: tamperedAudit.invariants.allQuestionsApproved,
      fingerprint: tamperedFingerprint,
    },
  };
}

export type AgentDemo = Awaited<ReturnType<typeof buildAgentDemo>>;

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2);
  assert.ok(args.length <= 1 && args.every((arg) => ["--write", "--check"].includes(arg)),
    "Usage: npm run demo:agent -- [--write|--check]");
  const demo = await buildAgentDemo();
  const artifact = new URL("../content/agent-demo.json", import.meta.url);
  const serialized = JSON.stringify(demo, null, 2) + "\n";
  if (args.includes("--write")) await writeFile(artifact, serialized, "utf8");
  if (args.includes("--check")) {
    assert.equal(await readFile(artifact, "utf8"), serialized,
      "Demo artifact is stale; run npm run demo:agent -- --write");
  }
  console.log("StatInterview Agent demo — SYNTHETIC / no API key or database");
  for (const turn of demo.trace) {
    console.log(`${turn.sequenceNumber}. ${turn.questionId} | ${turn.phase ?? "verification"} | ${turn.action} | posterior ${turn.stateUpdated ? "updated" : "preserved"}`);
  }
  console.log(`Replay: ${demo.audit.summary.matchingSelections}/${demo.audit.summary.replayedTurns}; adaptive: ${demo.audit.summary.adaptiveDecisions}; terminal: ${demo.audit.finalDecision.action}`);
  console.log(`Approved-question tamper: ${demo.tamperCheck.detected ? "DETECTED" : "MISSED"}`);
  console.log(`SHA-256 policy fingerprint: ${demo.fingerprint}`);
  console.log("Scores are fixtures. This does not measure speech, model quality or human outcomes.");
}
