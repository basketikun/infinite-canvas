import type { ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { UserStatusActions } from "@workbench/components/layout/user-status-actions";

export function CanvasTopBar({ canvasScope }: { canvasScope: ScopeBinding }) {
    return <div className="pointer-events-none absolute left-0 right-0 top-0 z-50 flex h-16 items-center justify-between pl-1 pr-4">
        <div className="pointer-events-auto flex min-w-0 items-center gap-2">
            <UserStatusActions variant="canvas" region="canvas-leading" canvasScope={canvasScope} />
        </div>
        <div className="pointer-events-auto flex items-center gap-1.5">
            <UserStatusActions variant="canvas" canvasScope={canvasScope} />
        </div>
    </div>;
}
