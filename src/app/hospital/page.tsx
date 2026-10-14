import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import { HospitalDesk } from "@/components/world/HospitalDesk";

export const metadata: Metadata = { title: "Institution desk (sandbox)" };

export default function Page() {
  return (
    <Providers>
      <div className="h-dvh bg-[#e9edf3] p-4">
        <HospitalDesk />
      </div>
    </Providers>
  );
}
