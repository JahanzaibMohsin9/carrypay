import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import { AppShell } from "@/components/app/AppShell";

export const metadata: Metadata = { title: "CarryPay · Family app" };

export default function FamilyAppLayout({ children }: LayoutProps<"/app">) {
  return (
    <Providers>
      <div className="min-h-dvh bg-bg-deep">
        <AppShell>{children}</AppShell>
      </div>
    </Providers>
  );
}
