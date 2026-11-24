import { Check } from "lucide-react";
import { layouts, themes } from "@infinite-canvas/plugin-sdk/builtin";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { cn } from "@infinite-canvas/plugin-sdk/ui/utils";
import { applicationBinding, pluginRegistry } from "@workbench/lib/plugins/registry";
import { usePluginStore } from "@workbench/stores/use-plugin-store";
import { useThemeStore } from "@workbench/stores/use-theme-store";

const cardClass = "flex min-w-0 cursor-pointer flex-col gap-2 rounded-xl border p-3 text-left transition-colors hover:bg-muted focus-visible:outline-2";

function Section({ title, empty, restoreDisabled, onRestore, children }: { title: string; empty: string; restoreDisabled: boolean; onRestore: () => void; children: React.ReactNode[] }) {
    return <section className="mb-8" aria-label={title}>
        <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="m-0 text-sm font-semibold">{title}</h3>
            <Button variant="ghost" size="sm" disabled={restoreDisabled} onClick={onRestore}>恢复默认</Button>
        </div>
        {children.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div> : <p className="m-0 text-sm text-(--channel-tertiary)">{empty}</p>}
    </section>;
}

export function ConfigAppearance() {
    usePluginStore((state) => state.revision);
    const themeSelection = useThemeStore((state) => state.selection);
    const layoutSelection = usePluginStore((state) => state.layoutSelection);
    return <>
        <Section title="主题" empty="安装主题插件后，可在这里选择配色。" restoreDisabled={themeSelection === null} onRestore={() => useThemeStore.setState({ selection: null })}>
            {pluginRegistry.query(themes, applicationBinding).map(({ id, value }) => <button key={id} type="button" aria-pressed={themeSelection === id} className={cn(cardClass, themeSelection === id && "border-foreground")} onClick={() => useThemeStore.setState({ selection: id })}>
                <span aria-hidden className="flex h-14 overflow-hidden rounded-lg border" style={{ background: value.background, borderColor: value.border }}>
                    <span className="w-1/4" style={{ background: value.panel }} />
                    <span className="flex flex-1 flex-col justify-center gap-1.5 px-2">
                        <span className="h-1.5 w-2/3 rounded-full" style={{ background: value.text }} />
                        <span className="h-1.5 w-1/3 rounded-full" style={{ background: value.muted }} />
                    </span>
                    <span className="m-2 w-4 rounded" style={{ background: value.accent }} />
                </span>
                <span className="flex items-center gap-1.5 text-sm font-medium">{value.name}{themeSelection === id ? <Check aria-hidden className="size-3.5" /> : null}</span>
                <span className="text-xs leading-5 text-(--channel-tertiary)">{value.description}</span>
            </button>)}
        </Section>
        <Section title="页面布局" empty="安装布局插件后，可在这里切换导航样式。" restoreDisabled={layoutSelection === null} onRestore={() => usePluginStore.setState({ layoutSelection: null })}>
            {pluginRegistry.query(layouts, applicationBinding).map(({ id, value }) => <button key={id} type="button" aria-pressed={layoutSelection === id} className={cn(cardClass, layoutSelection === id && "border-foreground")} onClick={() => usePluginStore.setState({ layoutSelection: id })}>
                <span className="flex items-center gap-1.5 text-sm font-medium">{value.name}{layoutSelection === id ? <Check aria-hidden className="size-3.5" /> : null}</span>
                <span className="text-xs leading-5 text-(--channel-tertiary)">{value.description}</span>
            </button>)}
        </Section>
    </>;
}
