import type { ReactNode } from "react";
import { useEffect, useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App, ConfigProvider } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";

import { ClientRootInit } from "@/components/layout/client-root-init";
import { LocaleProvider } from "@/components/layout/locale-provider";
import { getAntThemeConfig } from "@/lib/app-theme";
import { useLocaleStore } from "@/stores/use-locale-store";
import { useThemeStore } from "@/stores/use-theme-store";

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
    const locale = useLocaleStore((state) => state.locale);
    const dark = theme === "dark";
    const antLocale = useMemo(() => (locale === "zh" ? zhCN : enUS), [locale]);

    useEffect(() => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.style.colorScheme = theme;
    }, [dark, theme]);

    return (
        <LocaleProvider>
            <ConfigProvider locale={antLocale} theme={getAntThemeConfig(dark)}>
                <App>
                    <QueryClientProvider client={queryClient}>
                        <ClientRootInit>{children}</ClientRootInit>
                    </QueryClientProvider>
                </App>
            </ConfigProvider>
        </LocaleProvider>
    );
}
