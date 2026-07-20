import { create } from "zustand";
import { persist } from "zustand/middleware";

import { AUTH_TOKEN_KEY, fetchCurrentUser, login, type AuthPayload, type AuthUser } from "@/services/control-plane/auth";

export type LocalUser = AuthUser;

type UserStore = {
    token: string;
    user: AuthUser | null;
    isReady: boolean;
    isLoading: boolean;
    login: (payload: AuthPayload) => Promise<void>;
    hydrateUser: () => Promise<void>;
    clearSession: () => void;
};

export const useUserStore = create<UserStore>()(
    persist(
        (set, get) => ({
            token: "",
            user: null,
            isReady: false,
            isLoading: false,
            login: async (payload) => {
                set({ isLoading: true });
                try {
                    const session = await login(payload);
                    set({ token: session.token, user: session.user, isReady: true, isLoading: false });
                } catch (error) {
                    set({ isLoading: false });
                    throw error;
                }
            },
            hydrateUser: async () => {
                const token = get().token;
                if (!token) return void set({ isReady: true });
                try {
                    const user = await fetchCurrentUser(token);
                    set({ user: user.role === "guest" ? null : user, token: user.role === "guest" ? "" : token, isReady: true });
                } catch {
                    set({ token: "", user: null, isReady: true });
                }
            },
            clearSession: () => set({ token: "", user: null, isReady: true }),
        }),
        { name: AUTH_TOKEN_KEY, partialize: (state) => ({ token: state.token }) },
    ),
);
