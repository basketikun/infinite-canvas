import { useId, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Puzzle } from "lucide-react";
import type { ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { getPluginErrorMessage } from "@infinite-canvas/shared/plugins";
import { PluginBoundary } from "@workbench/components/plugins/plugin-contributions";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { usePluginViewScope } from "@workbench/hooks/use-plugin-view-scope";
import { canvasThemes } from "@workbench/lib/canvas-theme";
import { resolveApplicationActions } from "@workbench/lib/plugins/application-actions";
import { usePluginStore } from "@workbench/stores/use-plugin-store";
import { useThemeStore } from "@workbench/stores/use-theme-store";
import { applicationActionClassName, registerBuiltinApplicationActions } from "./builtin-application-actions";
import { registerBuiltinCanvasLeadingActions } from "./builtin-canvas-leading-actions";

registerBuiltinApplicationActions();
registerBuiltinCanvasLeadingActions();

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    region?: "status" | "canvas-leading";
    canvasScope?: ScopeBinding;
};

export function UserStatusActions({ showConfig = true, variant = "default", region = "status", canvasScope }: UserStatusActionsProps) {
    const viewId = useId();
    const binding = usePluginViewScope(`application-actions:${viewId}:${region}`, undefined, canvasScope?.signal);
    usePluginStore((state) => state.revision);
    const theme = useThemeStore((state) => state.theme);
    const style = variant === "canvas" ? { color: canvasThemes[theme].node.text } : undefined;
    const actions = binding ? resolveApplicationActions({ variant, region, showConfig, canvasScope }, binding) : [];

    return <div data-slot="user-status-actions" data-region={region} className={region === "canvas-leading" ? "flex min-w-0 items-center gap-2" : "inline-flex shrink-0 items-center gap-1"}>
        {actions.map(({ item, ctx, entry, assertActive }) => {
            const failed = (error: unknown) => {
                console.error(`[plugins] ${entry.pluginId} ${entry.point}/${entry.id}/${item.id} action`, error);
                if (!binding!.signal.aborted && !ctx.scope.signal.aborted) toast.error(getPluginErrorMessage(error), workbenchMessageOptions.error);
            };
            const guard = (event: MouseEvent) => {
                try { assertActive(); }
                catch (error) { event.preventDefault(); event.stopPropagation(); failed(error); }
            };
            const icon = item.type === "content" ? null : item.icon ?? <Puzzle className="size-4" />;
            return <div key={`${entry.instanceId}:${item.id}`} data-application-action={item.id} className={region === "canvas-leading" && item.type === "content" ? "inline-flex min-w-0 items-center" : "inline-flex shrink-0 items-center"} onClickCapture={guard} onAuxClickCapture={guard}>
                {item.type === "content" ? <PluginBoundary resetKey={ctx} pluginId={ctx.id} contributionId={`${entry.point}/${entry.id}/${item.id}`} callbackName="content">{item.content}</PluginBoundary> : item.type === "route" ? (
                    <Link to={item.to} className={applicationActionClassName} style={style} aria-label={item.title} title={item.title}>{icon}</Link>
                ) : item.type === "external" ? (
                    <a href={item.href} target="_blank" rel="noopener noreferrer" className={applicationActionClassName} style={style} aria-label={item.title} title={item.title}>{icon}</a>
                ) : <button type="button" disabled={item.disabled} className={applicationActionClassName} style={style} aria-label={item.title} title={item.title} onClick={() => {
                    try { void Promise.resolve(item.run()).catch(failed); }
                    catch (error) { failed(error); }
                }}>{icon}</button>}
            </div>;
        })}
    </div>;
}
