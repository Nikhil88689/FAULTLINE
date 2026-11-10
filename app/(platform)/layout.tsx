import { SiteShell } from "@/components/shell/site-shell";

export default function PlatformLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <SiteShell>{children}</SiteShell>;
}
