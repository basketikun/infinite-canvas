import { AppError } from "./errors.js";

export function loadConfig() {
    return {
        port: Number(process.env.PORT || 4100),
        supabaseUrl: required("SUPABASE_URL"),
        supabasePublishableKey: required("SUPABASE_PUBLISHABLE_KEY"),
        supabaseSecretKey: required("SUPABASE_SECRET_KEY"),
        origins: (process.env.AGENT_API_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean),
        pi: {
            provider: required("PI_PROVIDER"),
            model: required("PI_MODEL"),
            apiKey: required("PI_API_KEY"),
            agentDir: required("PI_AGENT_DIR"),
        },
    };
}

function required(name: string) {
    const value = process.env[name]?.trim();
    if (!value) throw new AppError(`缺少环境变量 ${name}`, 500, "configuration_error");
    return value;
}
