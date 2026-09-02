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

export function normalizeVoiceTranscriptForDisplay(text: string): string {
  return text.replace(SPOKEN_PERCENTAGE, (original, spoken: string) => {
    const normalized = spokenNumberToArabic(spoken);
    return normalized === null ? original : normalized + "%";
  });
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
