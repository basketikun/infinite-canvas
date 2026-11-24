import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { BookOpen, Bot, Keyboard, Settings2 } from "lucide-react";
import { applicationActions } from "@infinite-canvas/plugin-sdk/builtin";
import { AnimatedThemeToggler } from "@workbench/components/ui/animated-theme-toggler";
import { DOCS_URL } from "@workbench/constant/env";
import { canvasThemes } from "@workbench/lib/canvas-theme";
import { hostActions } from "@workbench/lib/canvas/host-actions";
import { builtinPlugin } from "@workbench/lib/plugins/registry";
import { useConfigStore } from "@workbench/stores/use-config-store";
import { useAgentStore } from "@workbench/stores/use-agent-store";
import { useThemeStore } from "@workbench/stores/use-theme-store";
import { GitHubLink } from "./github-link";
import { VersionReleaseModal } from "./version-release-modal";

export const applicationActionClassName = "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-stone-600 transition-colors hover:bg-black/5 hover:text-stone-950 disabled:cursor-not-allowed disabled:opacity-40 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white [&_svg]:size-4";

let registered = false;
export function registerBuiltinApplicationActions() {
    if (registered) return;
    registered = true;
    builtinPlugin.extensions.contribute(applicationActions, {
        id: "builtin:application-actions",
        value: {
            transform: ({ ctx, target, items }) => {
                if (target.region !== "status") return [...items];
                const theme = useThemeStore.getState().theme;
                const style = target.variant === "canvas" ? { color: canvasThemes[theme].node.text } : undefined;
                const themeTitle = theme === "dark" ? "切换到浅色主题" : "切换到深色主题";
                const canvasScope = target.canvasScope;
                return [
                    { id: "builtin:docs", type: "external", title: "文档", icon: <BookOpen className="size-4" />, href: DOCS_URL },
                    { id: "builtin:config", type: "action", title: "配置", icon: <Settings2 className="size-4" />, hidden: !target.showConfig, run: () => {
                        ctx.scope.signal.throwIfAborted();
                        useConfigStore.getState().openConfigDialog(false);
                    } },
                    { id: "builtin:theme", type: "content", title: themeTitle, content: <AnimatedThemeToggler theme={theme} signal={ctx.scope.signal} onThemeChange={(next) => {
                        ctx.scope.signal.throwIfAborted();
                        useThemeStore.getState().setTheme(next);
                    }} className={applicationActionClassName} style={style} aria-label={themeTitle} title={themeTitle} /> },
                    { id: "builtin:version", type: "content", title: "查看版本更新", content: <VersionReleaseModal style={style} /> },
                    { id: "builtin:github", type: "content", title: "GitHub", content: <GitHubLink className="size-7 bg-transparent text-base hover:bg-transparent dark:hover:bg-transparent" style={style} /> },
                    ...items,
                    ...(canvasScope ? [
                        { id: "builtin:shortcuts", type: "action" as const, title: "快捷键", icon: <Keyboard className="size-4" />, run: () => hostActions.canvasOpenShortcuts(undefined, ctx.signal) },
                        { id: "builtin:agent", type: "content" as const, title: "Agent", content: <CanvasAgentAction /> },
                    ] : []),
                ];
            },
        },
    });
}

function CanvasAgentAction() {
    const open = useAgentStore((state) => state.panelOpen);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return <div className="flex items-center gap-1.5 pl-0.5">
        <span className="h-6 w-px" style={{ background: theme.toolbar.border }} />
        <Button
            variant="ghost"
            className="h-10 rounded-xl px-3 font-medium"
            style={{ background: open ? theme.toolbar.activeBg : theme.toolbar.panel, color: theme.node.text, boxShadow: "0 10px 30px rgba(28,25,23,.10)" }}
            onClick={() => {
                const panel = useAgentStore.getState();
                if (panel.panelOpen) panel.closePanel();
                else panel.openPanel();
            }}
        >
            <Bot className="size-4" />Agent
        </Button>
    </div>;
}
