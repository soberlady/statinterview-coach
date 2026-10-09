import type { Metadata } from "next";
import { PublicShowcase } from "../components/PublicShowcase";

export const metadata: Metadata = {
  title: "交互演示",
  description:
    "三分钟体验 StatInterview Coach 的验证、拒绝评分、自适应选题与决策回放。",
};

export default function ShowcasePage() {
  return <PublicShowcase />;
}
