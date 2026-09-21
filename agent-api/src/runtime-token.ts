import jwt from "jsonwebtoken";

import { AppError } from "./errors.js";
import type { RequestContext } from "./types.js";

export type RuntimeTokenClaims = RequestContext & { runtimeId: string; instanceId?: string; conversationId?: string };

export class RuntimeTokenService {
    constructor(private readonly secret: string) {
        if (!secret.trim()) throw new AppError("缺少运行时 token 密钥", 500, "configuration_error");
    }

    create(claims: RuntimeTokenClaims) {
        return jwt.sign(claims, this.secret, { algorithm: "HS256", noTimestamp: true });
    }

    parse(token: string): RuntimeTokenClaims {
        let parsed: unknown;
        try {
            parsed = jwt.verify(token, this.secret, { algorithms: ["HS256"] });
        } catch {
            throw new AppError("运行时 token 无效", 401, "invalid_runtime_token");
        }
        if (!isClaims(parsed)) throw new AppError("运行时 token 无效", 401, "invalid_runtime_token");
        return parsed;
    }
}

function isClaims(value: unknown): value is RuntimeTokenClaims {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    const required = [record.userId, record.projectId, record.canvasWorkspaceId, record.runtimeId].every((item) => typeof item === "string" && item.length > 0);
    if (!required) return false;
    if (record.conversationId !== undefined && (typeof record.conversationId !== "string" || !record.conversationId)) return false;
    if (record.instanceId !== undefined && (typeof record.instanceId !== "string" || !record.instanceId)) return false;
    return true;
}
