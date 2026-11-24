import type { PluginNavigationEntry } from "@infinite-canvas/plugin-sdk";
import { createContext } from "react";
import type { LucideIcon } from "lucide-react";

type NavigationTool = {
    /**
     * 导航对应的一级路由。
     */
    slug: string;
    /**
     * 导航显示名称。
     */
    label: string;
    /**
     * 导航图标。
     */
    icon: LucideIcon;
};

export const NavigationContext = createContext<readonly NavigationTool[]>([]);

export const NavigationCatalogContext = createContext<readonly PluginNavigationEntry[]>([]);
