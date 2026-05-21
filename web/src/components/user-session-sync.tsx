"use client";

import { useEffect } from "react";

import { useAiConfigStore } from "@/stores/use-ai-config-store";
import { useUserStore } from "@/stores/use-user-store";

export function UserSessionSync() {
  const hydrateUser = useUserStore((state) => state.hydrateUser);
  const userPrefs = useUserStore((state) => state.user?.preferences);
  const hydrateFromPreferences = useAiConfigStore((state) => state.hydrateFromPreferences);

  useEffect(() => {
    void hydrateUser();
  }, [hydrateUser]);

  // 用户信息从 /api/auth/me 拉回来后，立即用服务器偏好覆盖本地生图默认值。
  // 未登录或新注册没存过偏好时，落到 defaultConfig（auto / auto / 1）。
  useEffect(() => {
    hydrateFromPreferences(userPrefs);
  }, [hydrateFromPreferences, userPrefs]);

  return null;
}
