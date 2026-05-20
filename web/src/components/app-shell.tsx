"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { AppTopNav } from "@/components/app-top-nav";
import { navigationTools, type NavigationToolSlug } from "@/lib/navigation-tools";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return <MainAppShell pathname={pathname}>{children}</MainAppShell>;
}

function MainAppShell({ pathname, children }: { pathname: string; children: ReactNode }) {
  const slug = pathname.split("/").filter(Boolean)[0];
  const activeToolSlug = navigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;
  const isCanvasDetail = /^\/canvas\/[^/]+/.test(pathname);

  return (
    <ShellFrame>
      <AppTopNav activeToolSlug={activeToolSlug} hideHeader={isCanvasDetail} />
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </ShellFrame>
  );
}

function ShellFrame({ children }: { children: ReactNode }) {
  return <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">{children}</div>;
}
