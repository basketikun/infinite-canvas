import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Home, Maximize2, Menu, Plus, Settings2 } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AppConfigModal } from "@/components/layout/app-config-modal";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

export function AppSidebar() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const autoConnectRef = useRef(false);
    const agentToken = useAgentStore((state) => state.token);
    const agentEnabled = useAgentStore((state) => state.enabled);
    const agentConnected = useAgentStore((state) => state.connected);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const togglePanel = useAgentStore((state) => state.togglePanel);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const ownerUserId = useUserStore((state) => state.user?.id);
    const allProjects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const slug = pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = navigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;
    const hideChrome = /^\/canvas\/[^/]+/.test(pathname);

    const ownedProjects = useMemo(() => allProjects.filter((project) => project.localOwnerUserId === ownerUserId), [allProjects, ownerUserId]);
    const recentProjects = useMemo(() => [...ownedProjects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8), [ownedProjects]);

    useEffect(() => {
        if (autoConnectRef.current || agentEnabled || agentConnected || !agentToken.trim()) return;
        autoConnectRef.current = true;
        connectAgent({ silent: true });
    }, [agentConnected, agentEnabled, agentToken, connectAgent]);

    const createAndEnter = () => {
        const id = createProject(t("canvas.defaultTitle", { count: ownedProjects.length + 1 }));
        navigate(`/canvas/${id}`);
    };

    const navItems = [
        { to: "/", icon: Home, label: t("navigation.home"), active: pathname === "/" },
        { to: "/canvas", icon: Maximize2, label: t("navigation.canvas"), active: pathname.startsWith("/canvas") },
    ];

    return (
        <>
            {hideChrome ? null : (
            <aside className="hidden h-full w-60 shrink-0 flex-col border-r border-stone-200 bg-stone-50 px-3 py-4 dark:border-stone-800 dark:bg-stone-950 md:flex">
                <Link to="/" className="mb-5 flex items-center gap-2 px-1 text-sm font-semibold leading-none text-stone-950 dark:text-stone-100">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold leading-none text-white">CR</span>
                    <span className="truncate text-base">{t("meta.title")}</span>
                </Link>

                <button type="button" onClick={createAndEnter} className="mb-5 flex h-10 items-center gap-2 rounded-xl border border-stone-200 px-3 text-sm text-stone-700 transition hover:bg-stone-100 dark:border-stone-800 dark:text-stone-200 dark:hover:bg-stone-900">
                    <Plus className="size-4" />
                    {t("canvas.create")}
                </button>

                <nav className="flex flex-col gap-0.5">
                    {navItems.map(({ to, icon: Icon, label, active }) => (
                        <Link key={to} to={to} className={cn("flex h-10 items-center gap-2.5 rounded-xl px-3 text-sm transition", active ? "bg-stone-200/70 font-medium text-stone-950 dark:bg-stone-800 dark:text-stone-100" : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-900")}>
                            <Icon className="size-4 shrink-0" />
                            <span className="truncate">{label}</span>
                        </Link>
                    ))}
                    <button type="button" onClick={() => openConfigDialog(false)} className="flex h-10 items-center gap-2.5 rounded-xl px-3 text-left text-sm text-stone-600 transition hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-900">
                        <Settings2 className="size-4 shrink-0" />
                        <span className="truncate">{t("navigation.config")}</span>
                    </button>
                    <button type="button" onClick={togglePanel} className="flex h-10 items-center gap-2.5 rounded-xl px-3 text-left text-sm text-stone-600 transition hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-900">
                        <Bot className="size-4 shrink-0" />
                        <span className="truncate">Agent</span>
                    </button>
                </nav>

                {recentProjects.length ? (
                    <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
                        <div className="px-3 text-xs font-medium text-stone-400 dark:text-stone-500">{t("canvas.recentProjects")}</div>
                        <div className="mt-1 flex flex-col gap-0.5">
                            {recentProjects.map((project) => (
                                <Link key={project.id} to={`/canvas/${project.id}`} className="truncate rounded-xl px-3 py-2 text-sm text-stone-600 transition hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-900">
                                    {project.title}
                                </Link>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="flex-1" />
                )}

                <div className="mt-4 border-t border-stone-200 pt-3 dark:border-stone-800">
                    <UserStatusActions showConfig={false} />
                </div>
            </aside>
            )}

            {hideChrome ? null : (
            <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-stone-200 bg-background/90 px-4 backdrop-blur-xl dark:border-stone-800 md:hidden">
                <div className="flex min-w-0 items-center gap-2">
                    <button type="button" className="inline-flex size-8 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white" onClick={() => setMobileNavOpen(true)} aria-label={t("topNav.openMenu")} title={t("topNav.menu")}>
                        <Menu className="size-5" />
                    </button>
                    <Link to="/" className="flex items-center gap-2 text-sm font-semibold leading-none text-stone-950 dark:text-stone-100">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-500 text-[9px] font-bold leading-none text-white">CR</span>
                        <span className="truncate text-base font-medium">{t("meta.title")}</span>
                    </Link>
                </div>
                <UserStatusActions />
            </header>
            )}

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
            <AppConfigModal />
        </>
    );
}
