import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { Link } from "react-router-dom";
import type { PluginLayoutProps } from "@infinite-canvas/plugin-sdk";
import { cn } from "@infinite-canvas/plugin-sdk/ui/utils";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@workbench/components/ui/sheet";

export function MobileNavDrawer({ items }: { items: PluginLayoutProps["items"] }) {
    const [open, setOpen] = useState(false);
    const content = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const desktop = window.matchMedia("(min-width: 48rem)");
        const closeOnDesktop = () => { if (desktop.matches) setOpen(false); };
        closeOnDesktop();
        desktop.addEventListener("change", closeOnDesktop);
        return () => desktop.removeEventListener("change", closeOnDesktop);
    }, [open]);
    return <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
            <button type="button" className="inline-flex size-8 shrink-0 items-center justify-center text-muted-foreground md:hidden" aria-label="打开导航菜单">
                <Menu className="size-5" />
            </button>
        </SheetTrigger>
        <SheetContent side="left" ref={content} tabIndex={-1} aria-describedby={undefined} showCloseButton={false}
            onOpenAutoFocus={(event) => { event.preventDefault(); content.current?.focus({ preventScroll: true }); }}
            className="max-w-full gap-0 bg-(--workbench-elevated-panel) text-(--workbench-elevated-text) outline-none data-[side=left]:w-[280px] data-[side=left]:border-0"
            overlayClassName="bg-black/45 supports-backdrop-filter:backdrop-blur-none">
            <SheetHeader className="h-[57px] shrink-0 flex-row items-center gap-2 border-b px-6 py-4">
                <SheetClose className="grid size-6 place-items-center rounded text-current/50 hover:bg-muted hover:text-current" aria-label="关闭">
                    <X className="size-4" />
                </SheetClose>
                <SheetTitle className="text-base font-semibold text-inherit">导航</SheetTitle>
            </SheetHeader>
            <nav aria-label="主导航" className="min-h-0 flex-1 space-y-1 overflow-y-auto p-6">
                {items.map((item) => <SheetClose key={item.id} asChild>
                    <Link to={item.to} aria-current={item.active ? "page" : undefined}
                        className={cn("flex items-center gap-3 rounded-lg px-3 py-3 text-base text-inherit transition hover:bg-muted [&_svg]:size-5", item.active && "font-medium")}>
                        {item.label}
                    </Link>
                </SheetClose>)}
            </nav>
        </SheetContent>
    </Sheet>;
}
