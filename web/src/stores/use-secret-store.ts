"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export const SECRET_STORE_KEY = "infinite-canvas:secret_store";

type SecretStore = {
    apiKeysByChannelId: Record<string, string>;
    webdavPassword: string;
    agentToken: string;
    setChannelApiKey: (channelId: string, apiKey: string) => void;
    setWebdavPassword: (password: string) => void;
    setAgentToken: (token: string) => void;
    clearSecrets: () => void;
};

export const useSecretStore = create<SecretStore>()(
    persist(
        (set) => ({
            apiKeysByChannelId: {},
            webdavPassword: "",
            agentToken: "",
            setChannelApiKey: (channelId, apiKey) => set((state) => ({ apiKeysByChannelId: { ...state.apiKeysByChannelId, [channelId]: apiKey } })),
            setWebdavPassword: (webdavPassword) => set({ webdavPassword }),
            setAgentToken: (agentToken) => set({ agentToken }),
            clearSecrets: () => set({ apiKeysByChannelId: {}, webdavPassword: "", agentToken: "" }),
        }),
        { name: SECRET_STORE_KEY },
    ),
);
