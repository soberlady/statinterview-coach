import type { Metadata } from "next";
import { ReportView } from "../../components/ReportView";

export const metadata: Metadata = {
  title: "能力诊断报告",
};

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ReportView interviewId={id} />;
}
