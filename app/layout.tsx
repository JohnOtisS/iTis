import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "iTis AI — Không gian trí tuệ cao cấp",
  description: "AI workspace với Smart Model Router, quản lý token và chi phí OpenAI.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body>{children}</body></html>;
}
