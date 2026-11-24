import { appearanceVariables } from "@workbench/lib/plugin-appearance";
import { type ReactNode, useLayoutEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@infinite-canvas/plugin-sdk/ui/tooltip";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";

import { ClientRootInit } from "@workbench/components/layout/client-root-init";
import { Toaster } from "@workbench/components/ui/sonner";
import { useThemeStore } from "@workbench/stores/use-theme-store";

dayjs.locale("zh-cn");

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            retry: false,
            refetchOnWindowFocus: false,
        },
    },
});

export function AppProviders({ children }: { children: ReactNode }) {
    const theme = useThemeStore((state) => state.theme);
    const appearance = useThemeStore((state) => state.appearance);
    useLayoutEffect(() => {
        const root = document.documentElement;
        root.classList.toggle("dark", theme === "dark");
        root.style.colorScheme = theme;
        if (!appearance || appearance.useDefaultColors) return;
        const variables = appearanceVariables(appearance);
        root.dataset.workbenchPalette = appearance.id;
        for (const [key, value] of Object.entries(variables)) root.style.setProperty(`--${key}`, value);
        return () => {
            delete root.dataset.workbenchPalette;
            for (const key of Object.keys(variables)) root.style.removeProperty(`--${key}`);
        };
    }, [appearance, theme]);

    return (
        <QueryClientProvider client={queryClient}>
            <TooltipProvider>
                <ClientRootInit>{children}</ClientRootInit>
                <Toaster />
            </TooltipProvider>
        </QueryClientProvider>
    );
}
