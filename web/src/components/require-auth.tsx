"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useUserStore } from "@/stores/use-user-store";

type RequireAuthProps = {
  children: ReactNode;
  fallback?: ReactNode;
};

export function RequireAuth({ children, fallback }: RequireAuthProps) {
  const router = useRouter();
  const pathname = usePathname();
  const token = useUserStore((state) => state.token);
  const user = useUserStore((state) => state.user);
  const isReady = useUserStore((state) => state.isReady);

  useEffect(() => {
    if (!isReady) return;
    if (!token || !user || user.role === "guest") {
      router.replace(`/login?redirect=${encodeURIComponent(pathname || "/")}`);
    }
  }, [isReady, pathname, router, token, user]);

  if (!isReady || !token || !user || user.role === "guest") {
    return fallback ?? <div className="flex h-full min-h-[60vh] items-center justify-center text-sm text-stone-500" />;
  }

  return <>{children}</>;
}
