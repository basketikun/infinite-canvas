import type { ReactNode } from "react";

export function AppTopBar({ notice, actions }: { notice?: ReactNode; actions: ReactNode }) {
    return <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border bg-background/90 px-4 backdrop-blur-xl">
        <div className="min-w-0 flex-1">
            {/* 公告信息预留：后续由公告数据传入 notice。 */}
            <div data-slot="app-announcement" aria-live="polite" className="min-w-0 truncate text-xs text-muted-foreground">{notice}</div>
        </div>
        <div className="flex shrink-0 items-center">{actions}</div>
    </header>;
}
