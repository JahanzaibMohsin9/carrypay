import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import { BankConsole } from "@/components/world/BankConsole";

export const metadata: Metadata = { title: "Payment rails (sandbox)" };

export default function Page() {
  return (
    <Providers>
      <div className="h-dvh bg-[#0b1016] p-4">
        <BankConsole />
      </div>
    </Providers>
  );
}
