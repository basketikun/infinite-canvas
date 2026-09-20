import { createClient } from "@supabase/supabase-js";

import { AppError } from "./errors.js";

export const BUILTIN_TEST_EMAIL = "test@research-canvas.test";
const TEST_PASSWORD = "12345678";
const USERS_PER_PAGE = 1000;

export async function provisionBuiltinTestAccount(supabaseUrl: string, secretKey: string) {
    const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const existingUserId = await findUserId(admin);
    if (existingUserId) {
        const { error } = await admin.auth.admin.updateUserById(existingUserId, {
            password: TEST_PASSWORD,
            email_confirm: true,
            user_metadata: { user_name: "test", full_name: "test" },
        });
        if (error) throw provisionError();
        return;
    }
    const { error } = await admin.auth.admin.createUser({
        email: BUILTIN_TEST_EMAIL,
        password: TEST_PASSWORD,
        email_confirm: true,
        user_metadata: { user_name: "test", full_name: "test" },
    });
    const code = (error as { code?: string } | null)?.code;
    if (!error || code === "email_exists" || code === "user_already_exists") return;
    throw provisionError();
}

async function findUserId(admin: ReturnType<typeof createClient>) {
    for (let page = 1; ; page += 1) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE });
        if (error) throw provisionError();
        const user = data.users.find((item) => item.email?.toLowerCase() === BUILTIN_TEST_EMAIL);
        if (user) return user.id;
        if (data.users.length < USERS_PER_PAGE) return null;
    }
}

function provisionError() {
    return new AppError("初始化内置 test 账号失败", 500, "test_account_provision_failed");
}
