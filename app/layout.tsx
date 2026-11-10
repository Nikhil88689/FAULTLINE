import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "FAULTLINE | The Living Systems Observatory",
    template: "%s | FAULTLINE",
  },
  description:
    "A clear, calm observability workspace for distributed systems and controlled chaos previews.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body className="font-sans">{children}</body>
    </html>
  );
}
