import { create } from "zustand";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/services/api/supabase";

export type LocalUser = {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
    email: string;
};

type UserStore = {
    user: LocalUser | null;
    accessToken: string | null;
    loading: boolean;
    initialize: () => Promise<void>;
    signIn: (email: string, password: string) => Promise<void>;
    signUp: (email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
};

let authInitialized = false;

export const useUserStore = create<UserStore>()((set) => ({
    user: null,
    accessToken: null,
    loading: true,
    initialize: async () => {
        if (authInitialized) return;
        authInitialized = true;
        if (!supabase) {
            set({ loading: false });
            return;
        }
        const { data } = await supabase.auth.getSession();
        setSession(set, data.session);
        supabase.auth.onAuthStateChange((_event, session) => setSession(set, session));
    },
    signIn: async (email, password) => {
        if (!supabase) throw new Error("Supabase 尚未配置");
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
    },
    signUp: async (email, password) => {
        if (!supabase) throw new Error("Supabase 尚未配置");
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
    },
    signOut: async () => {
        if (supabase) await supabase.auth.signOut();
        set({ user: null, accessToken: null });
    },
}));

function setSession(set: (state: Partial<UserStore>) => void, session: Session | null) {
    const user = session?.user;
    set({
        user: user ? {
            id: user.id,
            username: String(user.user_metadata.user_name || user.email || user.id),
            displayName: String(user.user_metadata.full_name || user.email || user.id),
            avatarUrl: String(user.user_metadata.avatar_url || ""),
            email: user.email || "",
        } : null,
        accessToken: session?.access_token || null,
        loading: false,
    });
}
