import type { ReactNode } from "react";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppSidebar } from "@/components/layout/app-sidebar";

export default function UserLayout({ children }: { children: ReactNode }) {
    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground md:flex-row">
            <AppSidebar />
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
            <AgentPanel />
        </div>
    );
}
