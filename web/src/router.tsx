import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Outlet } from "react-router-dom";

import { PageLoading } from "@/components/layout/page-loading";
import UserLayout from "@/layouts/user-layout";
import HomePage from "@/pages/home";
import NotFound from "@/pages/not-found";

const ImagePage = lazy(() => import("@/pages/image"));
const VideoPage = lazy(() => import("@/pages/video"));
const AssetsPage = lazy(() => import("@/pages/assets"));
const PromptsPage = lazy(() => import("@/pages/prompts"));
const CanvasPage = lazy(() => import("@/pages/canvas"));
const CanvasProjectPage = lazy(() => import("@/pages/canvas/project"));

function LazyPage({ children }: { children: ReactNode }) {
    return <Suspense fallback={<PageLoading />}>{children}</Suspense>;
}

export const router = createBrowserRouter([
    {
        element: (
            <UserLayout>
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/", element: <HomePage /> },
            {
                path: "/image",
                element: (
                    <LazyPage>
                        <ImagePage />
                    </LazyPage>
                ),
            },
            {
                path: "/video",
                element: (
                    <LazyPage>
                        <VideoPage />
                    </LazyPage>
                ),
            },
            {
                path: "/assets",
                element: (
                    <LazyPage>
                        <AssetsPage />
                    </LazyPage>
                ),
            },
            {
                path: "/prompts",
                element: (
                    <LazyPage>
                        <PromptsPage />
                    </LazyPage>
                ),
            },
            {
                path: "/canvas",
                element: (
                    <LazyPage>
                        <CanvasPage />
                    </LazyPage>
                ),
            },
            {
                path: "/canvas/:id",
                element: (
                    <LazyPage>
                        <CanvasProjectPage />
                    </LazyPage>
                ),
            },
        ],
    },
    { path: "*", element: <NotFound /> },
]);
