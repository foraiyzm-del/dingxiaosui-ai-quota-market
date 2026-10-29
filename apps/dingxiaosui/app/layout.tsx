import type { Metadata } from "next";
import "./globals.css";
import "../event-access.css";

export const metadata: Metadata = {
  title: "紫丁香计划 · 山西农产品智能传播",
  description: "山西农业大学智能传播研究院发起的紫丁香计划官网与工作台。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}<script src="/event-access.js?v=direct-1" defer /></body>
    </html>
  );
}
