import type { Metadata } from "next";
import { InterviewRoom } from "../../components/InterviewRoom";

export const metadata: Metadata = {
  title: "面试诊断",
};

export default async function InterviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InterviewRoom interviewId={id} />;
}
