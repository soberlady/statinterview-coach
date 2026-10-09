import type { CandidateRouting } from "./agent-policy";

export function inferExperienceBand(background: string): CandidateRouting["experienceBand"] {
  const affirmative = background.toLowerCase().split(/[，。；！？,;!?\n]/u)
    .filter((clause) => !/(?:没有|尚未|未曾|并非|不是|不具备|不精通|非资深|不足|不到|未满|无经验)/u.test(clause))
    .join(" ");
  const beginner = /零基础|初学|入门|转行|没有项目|尚未/u.test(background);
  const advanced = /资深|高级|精通|(?:三|四|五|[3-9]|\d{2,})\s*年(?:以上)?(?:的)?(?:工作|项目|开发|分析|经验)/u.test(affirmative);
  return beginner ? "beginner" : advanced ? "advanced" : "intermediate";
}
