import { fileURLToPath } from "node:url";

import { AppError } from "./errors.js";
import type { PiRuntimeConfig } from "./pi-runtime.js";
import type { CodexMcpConfig } from "./codex/runtime.js";

export type RuntimeKind = "pi" | "codex";

export type AppConfig = {
    port: number;
    supabaseUrl: string;
    supabasePublishableKey: string;
    supabaseSecretKey: string;
    origins: string[];
    runtime: RuntimeKind;
    pi?: PiRuntimeConfig;
    codex?: {
        bin: string;
        apiKey: string;
        runtimeRoot: string;
        tokenSecret: string;
        mcp: CodexMcpConfig;
    };
};

export function loadConfig(): AppConfig {
    const port = Number(process.env.PORT || 4100);
    const runtime = (process.env.AGENT_RUNTIME || "pi").trim() === "codex" ? "codex" as const : "pi" as const;
    return {
        port,
        supabaseUrl: required("SUPABASE_URL"),
        supabasePublishableKey: required("SUPABASE_PUBLISHABLE_KEY"),
        supabaseSecretKey: required("SUPABASE_SECRET_KEY"),
        origins: (process.env.AGENT_API_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean),
        runtime,
        pi: runtime === "pi" ? {
            provider: required("PI_PROVIDER"),
            model: required("PI_MODEL"),
            apiKey: required("PI_API_KEY"),
            agentDir: required("PI_AGENT_DIR"),
        } : undefined,
        codex: runtime === "codex" ? {
            bin: process.env.CODEX_BIN?.trim() || "codex",
            apiKey: process.env.CODEX_API_KEY?.trim() || required("OPENAI_API_KEY"),
            runtimeRoot: required("AGENT_RUNTIME_ROOT"),
            tokenSecret: required("AGENT_RUNTIME_TOKEN_SECRET"),
            mcp: {
                command: process.execPath,
                args: mcpArgs(),
                loopbackUrl: `http://127.0.0.1:${port}/internal/runtime`,
            },
        } : undefined,
    };
}

function mcpArgs() {
    const compiled = fileURLToPath(new URL("./mcp/project-canvas-mcp.js", import.meta.url));
    const source = compiled.replace(/\.js$/, ".ts");
    const tsx = process.argv.find((value) => value.includes("tsx"));
    return tsx ? [tsx, source] : [compiled];
}

function required(name: string) {
    const value = process.env[name]?.trim();
    if (!value) throw new AppError(`缺少环境变量 ${name}`, 500, "configuration_error");
    return value;
}
