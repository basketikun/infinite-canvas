import crypto from "node:crypto";
import path from "node:path";

import { AppError } from "./errors.js";
import type { RequestContext } from "./types.js";

export function sanitizeUserId(userId: string) {
    const id = userId.trim();
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(id)) throw new AppError("无效用户", 400, "invalid_user");
    return id;
}

/** 路径 key，不是权限机制。 */
export function projectKey(projectId: string) {
    return crypto.createHash("sha256").update(projectId).digest("hex").slice(0, 24);
}

export type ProjectRuntimePaths = {
    root: string;
    workspace: string;
    codexHome: string;
    tmp: string;
};

export function projectRuntimePaths(runtimeRoot: string, ctx: Pick<RequestContext, "userId" | "projectId">): ProjectRuntimePaths {
    const root = path.join(runtimeRoot, "users", sanitizeUserId(ctx.userId), "projects", projectKey(ctx.projectId));
    return {
        root,
        workspace: path.join(root, "workspace"),
        codexHome: path.join(root, "codex-home"),
        tmp: path.join(root, "tmp"),
    };
}
