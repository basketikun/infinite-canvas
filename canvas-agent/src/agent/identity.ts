import crypto from "node:crypto";
import type { Request } from "express";

export const AGENT_KINDS = ["codex", "zcode", "trae", "claude"] as const;
export type ExternalAgentKind = (typeof AGENT_KINDS)[number];
export type ExternalAgentIdentity = {
    kind: ExternalAgentKind;
    name: string;
    instanceId: string;
};

const MAX_NAME_LENGTH = 64;
const MAX_INSTANCE_LENGTH = 128;

export function parseAgentIdentity(args: string[], generateInstance = true): ExternalAgentIdentity {
    const requestedKind = option(args, "--agent");
    const requestedName = option(args, "--name");
    const legacyDefaults = !requestedKind && !requestedName;
    const kind = legacyDefaults ? "codex" : requestedKind;
    const name = legacyDefaults ? "Codex" : requestedName;
    const instanceId = option(args, "--instance") || (generateInstance ? crypto.randomUUID() : "");
    if (!AGENT_KINDS.includes(kind as ExternalAgentKind)) throw new Error(`--agent 必须是 ${AGENT_KINDS.join("、")} 之一`);
    if (!name || name.length > MAX_NAME_LENGTH) throw new Error(`--name 必须为 1-${MAX_NAME_LENGTH} 个字符`);
    if (!instanceId || instanceId.length > MAX_INSTANCE_LENGTH) throw new Error(`--instance 必须为 1-${MAX_INSTANCE_LENGTH} 个字符`);
    return { kind: kind as ExternalAgentKind, name, instanceId };
}

export function agentIdentityHeaders(identity: ExternalAgentIdentity) {
    return {
        "x-canvas-agent-kind": identity.kind,
        "x-canvas-agent-name": identity.name,
        "x-canvas-agent-instance": identity.instanceId,
    };
}

export function readAgentIdentity(req: Pick<Request, "header">): ExternalAgentIdentity {
    const kind = String(req.header("x-canvas-agent-kind") || "");
    const name = String(req.header("x-canvas-agent-name") || "");
    const instanceId = String(req.header("x-canvas-agent-instance") || "");
    if (!kind && !name && !instanceId) return { kind: "codex", name: "Legacy MCP", instanceId: "legacy-mcp" };
    return parseAgentIdentity([
        "--agent", kind,
        "--name", name,
        "--instance", instanceId,
    ], false);
}

function option(args: string[], name: string) {
    const index = args.indexOf(name);
    return index >= 0 ? String(args[index + 1] || "").trim() : "";
}
