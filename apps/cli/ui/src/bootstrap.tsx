import React from "react";
import { createRoot } from "react-dom/client";
import "@infinite-canvas/workbench/styles/app.css";
import { RouterProvider } from "react-router-dom";

import { AppProviders } from "@infinite-canvas/workbench/components/layout/app-providers";

import { router } from "./router";

import { NavigationContext } from "@infinite-canvas/workbench/constant/navigation-tools";
import { navigationTools } from "./navigation";

document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <NavigationContext.Provider value={navigationTools}>
            <AppProviders>
                <RouterProvider router={router} />
            </AppProviders>
        </NavigationContext.Provider>
    </React.StrictMode>,
);
