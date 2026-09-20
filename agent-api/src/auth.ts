import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "./errors.js";

export type AuthenticatedRequest = {
    userId: string;
    token: string;
    database: SupabaseClient;
};

export class SupabaseAuth {
    private readonly authClient: SupabaseClient;

    constructor(
        private readonly url: string,
        private readonly publishableKey: string,
    ) {
        this.authClient = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    }

    async authenticate(authorization: string | undefined): Promise<AuthenticatedRequest> {
        const token = bearerToken(authorization);
        const { data, error } = await this.authClient.auth.getUser(token);
        if (error || !data.user) throw new AppError("登录状态无效", 401, "unauthorized");
        const database = createClient(this.url, this.publishableKey, {
            accessToken: async () => token,
            auth: { persistSession: false, autoRefreshToken: false },
        });
        return { userId: data.user.id, token, database };
    }
}

function bearerToken(value: string | undefined) {
    const match = /^Bearer\s+(.+)$/i.exec(value || "");
    if (!match?.[1]) throw new AppError("缺少登录凭据", 401, "unauthorized");
    return match[1];
}
