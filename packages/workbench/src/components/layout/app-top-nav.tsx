import { Link } from "react-router-dom";
import type { PluginLayoutProps } from "@infinite-canvas/plugin-sdk";
import { MobileNavDrawer } from "@workbench/components/layout/mobile-nav-drawer";
import { cn } from "@infinite-canvas/plugin-sdk/ui/utils";

export function AppTopNav({ items, brand, actions }: Pick<PluginLayoutProps, "items" | "brand" | "actions">) {
    return <header className="sticky top-0 z-20 h-14 shrink-0 border-b border-border bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-2 px-3 sm:gap-5 sm:px-6">
            {brand}
            {items.length > 0 && <MobileNavDrawer items={items} />}
            <nav aria-label="主导航" className="hide-scrollbar hidden h-full min-w-0 flex-1 items-stretch gap-6 overflow-x-auto md:flex">
                {items.map((item) => <Link key={item.id} to={item.to} aria-current={item.active ? "page" : undefined}
                    className={cn("inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b text-sm [&_svg]:size-4", item.active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                    {item.label}
                </Link>)}
            </nav>
            <div className="hide-scrollbar ml-auto flex min-w-0 items-center overflow-x-auto">{actions}</div>
        </div>
    </header>;
}
