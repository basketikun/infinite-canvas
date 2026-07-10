import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AppTopNav } from "@/components/layout/app-top-nav";
import { getCanvasSession } from "@/lib/server/canvas-auth";

export const dynamic = "force-dynamic";

export default async function UserLayout({ children }: { children: ReactNode }) {
    const session = await getCanvasSession();
    if (!session) redirect("/login");

    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
            <AppTopNav username={session.username} />
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
    );
}
