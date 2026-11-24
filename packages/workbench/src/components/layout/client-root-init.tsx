import { useEffect, type ReactNode } from "react";
import { ensurePluginsLoaded } from "@workbench/lib/plugins/manager";

import { usePromptSourceScheduler } from "@workbench/hooks/use-prompt-source-scheduler";

export function ClientRootInit({ children }: { children: ReactNode }) {
    usePromptSourceScheduler();
    useEffect(() => { void ensurePluginsLoaded().catch((error) => console.error("[plugins] startup failed", error)); }, []);

    return <>{children}</>;
}
