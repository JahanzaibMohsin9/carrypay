import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import { OfficerDesk } from "@/components/world/OfficerDesk";

export const metadata: Metadata = { title: "Remittance desk (sandbox bank)" };

export default function Page() {
  return (
    <Providers>
      <div className="h-dvh bg-[#0b1016] p-2 sm:p-4">
        <OfficerDesk />
      </div>
    </Providers>
  );
}
