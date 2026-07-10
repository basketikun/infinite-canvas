"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const initialized = useRef(false);

    useEffect(() => {
        if (initialized.current) return;
        initialized.current = true;

        const searchParams = new URLSearchParams(window.location.search);
        for (const key of ["baseUrl", "baseurl", "apiKey", "apikey"]) searchParams.delete(key);
        const nextSearch = searchParams.toString();
        if (nextSearch !== window.location.search.slice(1)) {
            window.history.replaceState(null, "", `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`);
        }
    }, []);

    return <>{children}</>;
}
