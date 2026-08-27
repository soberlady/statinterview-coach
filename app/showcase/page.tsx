import type { Metadata } from "next";
import benchmark from "@/content/policy-benchmark.json";
import { PublicShowcase } from "../components/PublicShowcase";

export const metadata: Metadata = {
  title: "交互演示",
  description:
    "三分钟体验 StatInterview Coach 的验证、拒绝评分、自适应选题与决策回放。",
};

export default function ShowcasePage() {
  return (
    <PublicShowcase
      relativeMaeReduction={Math.abs(
        benchmark.adaptiveSelection.comparisons.adaptive_vs_fixed
          .relative_mae_change_pct,
      )}
      simulatedCandidates={
        benchmark.adaptiveSelection.design.total_simulated_candidates
      }
    />
  );
}
