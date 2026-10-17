import type { ComponentType } from "react";
import { createBrowserRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import NotFound from "@/pages/not-found";

// 页面按路由懒加载，避免所有页面打进首屏包
const page = (load: () => Promise<{ default: ComponentType }>) => async () => ({ Component: (await load()).default });

export const router = createBrowserRouter([
    {
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/", lazy: page(() => import("@/pages/home")) },
            { path: "/image", lazy: page(() => import("@/pages/image")) },
            { path: "/video", lazy: page(() => import("@/pages/video")) },
            { path: "/assets", lazy: page(() => import("@/pages/assets")) },
            { path: "/prompts", lazy: page(() => import("@/pages/prompts")) },
            { path: "/canvas", lazy: page(() => import("@/pages/canvas")) },
            { path: "/canvas/:id", lazy: page(() => import("@/pages/canvas/project")) },
            { path: "/config", lazy: page(() => import("@/pages/config")) },
        ],
    },
    { path: "*", element: <NotFound /> },
]);
