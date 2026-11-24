import { PluginPageView } from "@infinite-canvas/workbench/components/plugins/plugin-contributions";
import { createBrowserRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@infinite-canvas/workbench/layouts/user-layout";
import AssetsPage from "@infinite-canvas/workbench/pages/assets";
import CanvasPage from "@infinite-canvas/workbench/pages/canvas";
import CanvasProjectPage from "@infinite-canvas/workbench/pages/canvas/project";
import CreatePage from "@infinite-canvas/workbench/pages/create";
import CreateHistoryPage from "@infinite-canvas/workbench/pages/create/history";
import HomePage from "@infinite-canvas/workbench/pages/home";
import NotFound from "@infinite-canvas/workbench/pages/not-found";
import PromptsPage from "@infinite-canvas/workbench/pages/prompts";

export const router = createBrowserRouter([
    {
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/extensions/:pageId", element: <PluginPageView /> },
            { path: "/", element: <HomePage /> },
            { path: "/create/history", element: <CreateHistoryPage /> },
            { path: "/create", element: <CreatePage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
            { path: "*", element: <NotFound /> },
        ],
    },
]);
