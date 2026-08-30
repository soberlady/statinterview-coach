import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createPrior,
  scoreQuestionUtility,
  summarizePosterior,
  updatePosterior,
} from "../app/lib/rasch-policy";

type Fixture = {
  prior: {
    mean: number;
    standardDeviation: number;
  };
  utilityInput: {
    difficulty: number;
    preferredDifficulty: number;
    difficultyMatch: number;
    questionRelevance: number;
    skillJobWeight: number;
    maxJobWeight: number;
    answeredCount: number;
    expectedSeconds: number;
    remainingSeconds: number;
  };
  cases: Array<{
    name: string;
    difficulty: number;
    outcome: number;
    expected: Record<string, number>;
  }>;
};

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/policy-parity.json", import.meta.url),
    "utf8",
  ),
) as Fixture;

function close(actual: number, expected: number, tolerance = 1e-10) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} was not within ${tolerance} of ${expected}`,
  );
}

for (const item of fixture.cases) {
  test(`TypeScript policy matches Python golden fixture: ${item.name}`, () => {
    const prior = createPrior(
      fixture.prior.mean,
      fixture.prior.standardDeviation,
    );
    const posterior = updatePosterior(
      prior,
      item.difficulty,
      item.outcome,
    );
    const summary = summarizePosterior(posterior);
    const utility = scoreQuestionUtility({
      posterior,
      ...fixture.utilityInput,
    });

    close(summary.mean, item.expected.mean);
    close(
      summary.standardDeviation,
      item.expected.standardDeviation,
    );
    close(
      summary.lowerCredibleBound,
      item.expected.lowerCredibleBound,
    );
    close(
      summary.upperCredibleBound,
      item.expected.upperCredibleBound,
    );
    close(summary.entropy, item.expected.entropy);
    close(utility.informationGain, item.expected.informationGain);
    close(
      utility.normalizedInformationGain,
      item.expected.normalizedInformationGain,
    );
    close(utility.jdRelevance, item.expected.jdRelevance);
    close(
      utility.difficultyMatch,
      item.expected.difficultyMatch,
    );
    close(utility.coverageNeed, item.expected.coverageNeed);
    close(utility.timeCost, item.expected.timeCost);
    close(utility.utility, item.expected.utility);
  });
}
