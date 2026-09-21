import crypto from "node:crypto";

import { AppError } from "./errors.js";
import type { RequestContext } from "./types.js";

export type RuntimeTokenClaims = RequestContext & { runtimeId: string };

export class RuntimeTokenService {
    constructor(private readonly secret: string) {
        if (!secret.trim()) throw new AppError("缺少运行时 token 密钥", 500, "configuration_error");
    }

    create(claims: RuntimeTokenClaims) {
        const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
        return `${payload}.${sign(this.secret, payload)}`;
    }

    parse(token: string): RuntimeTokenClaims {
        const parts = token.trim().split(".");
        if (parts.length !== 2 || !parts[0] || !parts[1]) throw new AppError("运行时 token 无效", 401, "invalid_runtime_token");
        if (sign(this.secret, parts[0]) !== parts[1]) throw new AppError("运行时 token 无效", 401, "invalid_runtime_token");
        let parsed: unknown;
        try {
            parsed = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
        } catch {
            throw new AppError("运行时 token 无效", 401, "invalid_runtime_token");
        }
        if (!isClaims(parsed)) throw new AppError("运行时 token 无效", 401, "invalid_runtime_token");
        return parsed;
    }
}

function sign(secret: string, payload: string) {
    return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function isClaims(value: unknown): value is RuntimeTokenClaims {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return [record.userId, record.projectId, record.canvasWorkspaceId, record.runtimeId].every((item) => typeof item === "string" && item.length > 0);
}
