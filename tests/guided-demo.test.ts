import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGuidedDemoPayload,
  evaluateGuidedDemoAnswer,
  GUIDED_DEMO_VERSION,
} from "../app/lib/guided-demo";
import { getInterviewQuestion } from "../app/lib/question-bank";

test("guided demo deterministically exercises VERIFY then ABSTAIN", () => {
  const anchor = getInterviewQuestion("statistics_ml_002");
  assert.ok(anchor);

  const firstStep = buildGuidedDemoPayload({
    question: anchor,
    completedTurns: 0,
    substantiveTurns: 0,
  });
  const weak = firstStep.answerOptions.find((option) => option.id === "weak");
  assert.equal(firstStep.version, GUIDED_DEMO_VERSION);
  assert.equal(firstStep.synthetic, true);
  assert.equal(weak?.recommended, true);
  assert.ok(weak);

  const weakEvaluation = evaluateGuidedDemoAnswer(anchor, weak.answer);
  assert.equal(weakEvaluation.evaluator, "DEMO_FIXTURE");
  assert.equal(weakEvaluation.action, "VERIFY");
  assert.equal(weakEvaluation.reliability, "LOW");

  const verification = getInterviewQuestion(
    `${anchor.sourceQuestionId}__verify_0`,
  );
  assert.ok(verification);
  const verificationStep = buildGuidedDemoPayload({
    question: verification,
    completedTurns: 1,
    substantiveTurns: 1,
  });
  const stillWeak = verificationStep.answerOptions.find(
    (option) => option.id === "weak",
  );
  assert.equal(stillWeak?.recommended, true);
  assert.ok(stillWeak);
  assert.equal(
    evaluateGuidedDemoAnswer(verification, stillWeak.answer).action,
    "ABSTAIN",
  );
});

test("guided demo accepts only the exact strong fixture", () => {
  const anchor = getInterviewQuestion("sql_python_002");
  assert.ok(anchor);
  const laterStep = buildGuidedDemoPayload({
    question: anchor,
    completedTurns: 3,
    substantiveTurns: 2,
  });
  const strong = laterStep.answerOptions.find(
    (option) => option.id === "strong",
  );
  assert.equal(strong?.recommended, true);
  assert.ok(strong);

  const accepted = evaluateGuidedDemoAnswer(anchor, strong.answer);
  assert.equal(accepted.evaluator, "DEMO_FIXTURE");
  assert.equal(accepted.action, "ACCEPT");
  assert.equal(accepted.reliability, "HIGH");
  assert.equal(accepted.fixture?.answerVariant, "strong");
  assert.ok(accepted.evidence.length > 0);
  accepted.evidence.forEach((quote) => assert.ok(strong.answer.includes(quote)));

  const edited = evaluateGuidedDemoAnswer(
    anchor,
    `${strong.answer}\n我修改了夹具。`,
  );
  assert.equal(edited.evaluator, "STRUCTURE_HEURISTIC");
  assert.equal(edited.action, "ABSTAIN");
});
