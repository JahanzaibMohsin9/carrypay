import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import { CasePack } from "@/components/CasePack";

export const metadata: Metadata = { title: "Case pack" };

export default function Page() {
  return (
    <Providers>
      <div className="min-h-dvh bg-white">
        <CasePack />
      </div>
    </Providers>
  );
}
