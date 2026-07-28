import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host?.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(
    host ? `${protocol}://${host}` : "http://localhost:3000",
  );
  const description =
    "面向数据分析岗位的不确定性感知、自适应实时面试训练 Agent。";

  return {
    metadataBase,
    title: {
      default: "StatInterview Coach",
      template: "%s · StatInterview Coach",
    },
    description,
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      type: "website",
      title: "StatInterview Coach",
      description,
      images: [
        {
          url: "/og.png",
          width: 1734,
          height: 907,
          alt: "StatInterview 自适应能力诊断流程",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "StatInterview Coach",
      description,
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
