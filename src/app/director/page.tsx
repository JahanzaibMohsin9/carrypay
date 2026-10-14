import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import { DirectorPanel } from "@/components/world/DirectorPanel";
import { AgentConsole } from "@/components/world/AgentConsole";

export const metadata: Metadata = { title: "CarryPay · Director" };

export default function Page() {
  return (
    <Providers>
      <div className="flex h-dvh flex-col gap-3 bg-bg p-4">
        <DirectorPanel />
        <div className="min-h-0 flex-1">
          <AgentConsole />
        </div>
      </div>
    </Providers>
  );
}
