import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "住址風險評估 | Residence Risk TW",
  description: "輸入台灣地址，查詢淹水風險評估結果",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant-TW">
      <body className="min-h-screen flex flex-col bg-gray-100 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
