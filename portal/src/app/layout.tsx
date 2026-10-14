import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Security Operations Portal",
  description: "ศูนย์เฝ้าระวังความมั่นคงปลอดภัยไซเบอร์ โรงพยาบาลวาริชภูมิ",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
