export type PosteriorPoint = {
  theta: number;
  probability: number;
};

export type PosteriorSummary = {
  mean: number;
  standardDeviation: number;
  lowerCredibleBound: number;
  upperCredibleBound: number;
  entropy: number;
};

export type UtilitySignals = {
  utility: number;
  informationGain: number;
  normalizedInformationGain: number;
  jdRelevance: number;
  difficultyMatch: number;
  coverageNeed: number;
  timeCost: number;
};

const EPSILON = 1e-12;

export function normalizeDifficulty(bankDifficulty: number): number {
  return (bankDifficulty - 3) * 0.75;
}

export function createPrior(
  mean = 0,
  standardDeviation = 1,
): PosteriorPoint[] {
  if (standardDeviation <= 0) {
    throw new Error("standardDeviation must be positive");
  }

  const points = Array.from({ length: 61 }, (_, index) => {
    const theta = round(-3 + index * 0.1, 10);
    return {
      theta,
      probability: Math.exp(
        -0.5 * ((theta - mean) / standardDeviation) ** 2,
      ),
    };
  });
  return normalize(points);
}

export function updatePosterior(
  posterior: readonly PosteriorPoint[],
  difficulty: number,
  outcome: number,
): PosteriorPoint[] {
  if (outcome < 0 || outcome > 1) {
    throw new Error("outcome must be in [0, 1]");
  }
  assertPosterior(posterior);

  return normalize(
    posterior.map((point) => {
      const probabilityCorrect = clamp(
        sigmoid(point.theta - difficulty),
        EPSILON,
        1 - EPSILON,
      );
      const likelihood =
        probabilityCorrect ** outcome *
        (1 - probabilityCorrect) ** (1 - outcome);
      return {
        theta: point.theta,
        probability: point.probability * likelihood,
      };
    }),
  );
}

export function summarizePosterior(
  posterior: readonly PosteriorPoint[],
  credibleMass = 0.9,
): PosteriorSummary {
  if (credibleMass <= 0 || credibleMass >= 1) {
    throw new Error("credibleMass must be in (0, 1)");
  }
  assertPosterior(posterior);

  const mean = posterior.reduce(
    (total, point) => total + point.theta * point.probability,
    0,
  );
  const variance = posterior.reduce(
    (total, point) =>
      total + point.probability * (point.theta - mean) ** 2,
    0,
  );
  const tail = (1 - credibleMass) / 2;
  return {
    mean,
    standardDeviation: Math.sqrt(Math.max(0, variance)),
    lowerCredibleBound: quantile(posterior, tail),
    upperCredibleBound: quantile(posterior, 1 - tail),
    entropy: entropy(posterior),
  };
}

export function expectedInformationGain(
  posterior: readonly PosteriorPoint[],
  difficulty: number,
): number {
  assertPosterior(posterior);
  const predictiveCorrect = posterior.reduce(
    (total, point) =>
      total +
      point.probability * sigmoid(point.theta - difficulty),
    0,
  );
  const correctPosterior = updatePosterior(posterior, difficulty, 1);
  const incorrectPosterior = updatePosterior(posterior, difficulty, 0);
  const expectedEntropy =
    predictiveCorrect * entropy(correctPosterior) +
    (1 - predictiveCorrect) * entropy(incorrectPosterior);
  return Math.max(0, entropy(posterior) - expectedEntropy);
}

export function scoreQuestionUtility(input: {
  posterior: readonly PosteriorPoint[];
  difficulty: number;
  questionRelevance: number;
  skillJobWeight: number;
  maxJobWeight: number;
  answeredCount: number;
  expectedSeconds: number;
  remainingSeconds: number;
  difficultyMatch?: number;
}): UtilitySignals {
  const informationGain = expectedInformationGain(
    input.posterior,
    input.difficulty,
  );
  const normalizedInformationGain = clamp(
    informationGain / Math.log(2),
    0,
    1,
  );
  const safeMaxJobWeight =
    input.maxJobWeight > 0 ? input.maxJobWeight : 1;
  const jdRelevance = clamp(
    0.5 * input.questionRelevance +
      0.5 * (input.skillJobWeight / safeMaxJobWeight),
    0,
    1,
  );
  const coverageNeed =
    input.answeredCount === 0 ? 1 : 1 / (input.answeredCount + 1);
  const timeCost = Math.min(
    input.expectedSeconds / Math.max(input.remainingSeconds, 1),
    1,
  );
  const difficultyMatch = clamp(input.difficultyMatch ?? 0, 0, 1);
  return {
    utility:
      0.45 * normalizedInformationGain +
      0.25 * jdRelevance +
      0.15 * coverageNeed +
      0.15 * difficultyMatch -
      0.1 * timeCost,
    informationGain,
    normalizedInformationGain,
    jdRelevance,
    difficultyMatch,
    coverageNeed,
    timeCost,
  };
}

export function parsePosterior(
  value: string,
  fallbackMean = 0,
  fallbackStandardDeviation = 1,
): PosteriorPoint[] {
  try {
    const parsed = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.length >= 2 &&
      parsed.every(
        (point) =>
          point &&
          typeof point.theta === "number" &&
          typeof point.probability === "number",
      )
    ) {
      const posterior = parsed as PosteriorPoint[];
      assertPosterior(posterior);
      return posterior;
    }
  } catch {
    // The initial database state intentionally stores an empty array.
  }
  return createPrior(fallbackMean, Math.max(fallbackStandardDeviation, 0.22));
}

function normalize(points: PosteriorPoint[]): PosteriorPoint[] {
  const total = points.reduce(
    (sum, point) => sum + point.probability,
    0,
  );
  if (total <= 0) {
    throw new Error("posterior has zero probability mass");
  }
  return points.map((point) => ({
    theta: point.theta,
    probability: point.probability / total,
  }));
}

function quantile(
  posterior: readonly PosteriorPoint[],
  probability: number,
): number {
  let cumulative = 0;
  for (const point of posterior) {
    cumulative += point.probability;
    if (cumulative >= probability) return point.theta;
  }
  return posterior.at(-1)?.theta ?? 0;
}

function entropy(posterior: readonly PosteriorPoint[]): number {
  return -posterior.reduce(
    (total, point) =>
      point.probability > 0
        ? total + point.probability * Math.log(point.probability)
        : total,
    0,
  );
}

function assertPosterior(
  posterior: readonly PosteriorPoint[],
): void {
  if (posterior.length < 2) {
    throw new Error("posterior must contain at least two points");
  }
  let total = 0;
  for (let index = 0; index < posterior.length; index += 1) {
    const point = posterior[index];
    if (point.probability < 0) {
      throw new Error("posterior probabilities cannot be negative");
    }
    if (index > 0 && point.theta <= posterior[index - 1].theta) {
      throw new Error("posterior theta grid must be strictly increasing");
    }
    total += point.probability;
  }
  if (Math.abs(total - 1) > 1e-8) {
    throw new Error("posterior probabilities must sum to 1");
  }
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const inverse = Math.exp(-value);
    return 1 / (1 + inverse);
  }
  const direct = Math.exp(value);
  return direct / (1 + direct);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, precision: number): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}
