const CHINESE_DIGITS: Readonly<Record<string, number>> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const SMALL_UNITS: Readonly<Record<string, number>> = {
  十: 10,
  百: 100,
  千: 1000,
};

const SPOKEN_PERCENTAGE =
  /百分之\s*([负正零〇一二两三四五六七八九十百千万亿点\d.]+)/g;

const SPOKEN_NUMBER =
  "[负正零〇一二两三四五六七八九十百千万亿点\\d.。．]+";
const PERCENT_RATE_LABEL =
  "留存率|点击率|转化率|准确率|召回率|概率|比例|占比|置信水平|显著性水平";

export function normalizeVoiceTranscriptForDisplay(
  text: string,
  questionText = "",
): string {
  let normalizedText = text.replace(
    SPOKEN_PERCENTAGE,
    (original, spoken: string) => {
      const normalized = spokenNumberToArabic(spoken);
      return normalized === null ? original : normalized + "%";
    },
  );

  const questionPercentages = extractQuestionPercentages(questionText);
  if (!questionPercentages.size) return normalizedText;

  normalizedText = normalizedText.replace(/(?<=\d)[。．](?=\d)/g, ".");
  const rangePattern = new RegExp(
    `(${SPOKEN_NUMBER})\\s*(到|至|和|与|[-—~～])\\s*(${SPOKEN_NUMBER})(?=\\s*(?:之间|区间|范围))`,
    "g",
  );
  normalizedText = normalizedText.replace(
    rangePattern,
    (original, left: string, separator: string, right: string) => {
      const leftPercent = questionPercentage(left, questionPercentages);
      const rightPercent = questionPercentage(right, questionPercentages);
      return leftPercent === null || rightPercent === null
        ? original
        : `${leftPercent}%${separator}${rightPercent}%`;
    },
  );

  const leadingLabelPattern = new RegExp(
    `((?:${PERCENT_RATE_LABEL}|占)(?:为|是|约为|大约为|仅为|仅占)?\\s*)(${SPOKEN_NUMBER})(?!\\s*[%\\d])`,
    "g",
  );
  normalizedText = normalizedText.replace(
    leadingLabelPattern,
    (original, prefix: string, spoken: string) => {
      const percentage = questionPercentage(spoken, questionPercentages);
      return percentage === null ? original : `${prefix}${percentage}%`;
    },
  );

  const trailingLabelPattern = new RegExp(
    `(${SPOKEN_NUMBER})(\\s*的?\\s*(?:${PERCENT_RATE_LABEL}))`,
    "g",
  );
  return normalizedText.replace(
    trailingLabelPattern,
    (original, spoken: string, suffix: string) => {
      const percentage = questionPercentage(spoken, questionPercentages);
      return percentage === null ? original : `${percentage}%${suffix}`;
    },
  );
}

function extractQuestionPercentages(questionText: string): Set<string> {
  return new Set(
    Array.from(questionText.matchAll(/(\d+(?:\.\d+)?)\s*[%％]/g), (match) =>
      canonicalNumber(match[1]),
    ),
  );
}

function questionPercentage(
  spoken: string,
  questionPercentages: ReadonlySet<string>,
): string | null {
  const normalized = spokenNumberToArabic(spoken.replace(/[。．]/g, "."));
  if (normalized === null) return null;
  const canonical = canonicalNumber(normalized);
  return questionPercentages.has(canonical) ? canonical : null;
}

function canonicalNumber(value: string): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : value;
}

function spokenNumberToArabic(value: string): string | null {
  const sign = value.startsWith("负") ? "-" : "";
  const unsigned = value.replace(/^[负正]/, "");
  if (/^\d+(?:\.\d+)?$/.test(unsigned)) {
    return sign + unsigned;
  }

  const parts = unsigned.split("点");
  if (parts.length > 2 || !parts[0]) return null;

  const integer = chineseInteger(parts[0]);
  if (integer === null) return null;
  if (parts.length === 1) return sign + String(integer);

  const fraction = Array.from(parts[1]).map((character) => {
    if (/\d/.test(character)) return character;
    const digit = CHINESE_DIGITS[character];
    return digit === undefined ? null : String(digit);
  });
  if (!fraction.length || fraction.some((digit) => digit === null)) {
    return null;
  }
  return sign + integer + "." + fraction.join("");
}

function chineseInteger(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value);

  const characters = Array.from(value);
  if (characters.every((character) => character in CHINESE_DIGITS)) {
    return Number(
      characters.map((character) => CHINESE_DIGITS[character]).join(""),
    );
  }

  let total = 0;
  let section = 0;
  let current = 0;
  for (const character of characters) {
    const digit = CHINESE_DIGITS[character];
    if (digit !== undefined) {
      current = digit;
      continue;
    }

    const smallUnit = SMALL_UNITS[character];
    if (smallUnit !== undefined) {
      section += (current || 1) * smallUnit;
      current = 0;
      continue;
    }

    if (character === "万") {
      total += (section + current || 1) * 10_000;
      section = 0;
      current = 0;
      continue;
    }
    if (character === "亿") {
      total = (total + section + current || 1) * 100_000_000;
      section = 0;
      current = 0;
      continue;
    }
    return null;
  }
  return total + section + current;
}
