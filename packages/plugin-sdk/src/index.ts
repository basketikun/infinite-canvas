// 客户端插件公开入口；Node 入口单独从 /host 导入。
export * from "./types";
export { definePlugin } from "./define-plugin";
export { defineCommand } from "./commands";
export { defineExtensionPoint, contribute, defineCapability } from "./runtime/contracts";
export type { ExtensionPoint, Contribution, Capability, CapabilityHandle, CapabilityCallContext, ScopeBinding, RegisteredContribution, PluginExtensions, PluginCapabilities } from "./runtime/contracts";

export class SyncTransportError extends Error {
    /** detail 保存远端的原始失败原因，例如 HTTP 状态码或网络错误，宿主会随提示一起展示。 */
    constructor(readonly code: "AUTH" | "DIRECTORY" | "TEST" | "READ" | "WRITE" | "REMOTE_CONFLICT" | "REVISION_UNAVAILABLE" | "REDIRECT", readonly detail?: string) {
        super(detail ?? code);
        this.name = "SyncTransportError";
    }
}
