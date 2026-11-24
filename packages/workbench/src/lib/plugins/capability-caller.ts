import type { CapabilityCallContext, ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { PluginError } from "@infinite-canvas/shared/plugins";

type CapabilityCaller = { pluginId: string; packageName: string; scope: ScopeBinding; track<T>(action: () => T): T; assertActive: () => void };

// 只登记宿主创建的上下文。插件传给 capabilities.get 的 scope 不能替换调用者身份。
export const capabilityCallers = new WeakMap<AbortSignal, CapabilityCaller>();

export function capabilityCaller(context: CapabilityCallContext): CapabilityCaller {
    context.signal.throwIfAborted();
    const caller = capabilityCallers.get(context.callerSignal);
    if (!caller || caller.pluginId !== context.callerId) throw new PluginError("PLUGIN_SCOPE_CLOSED");
    caller.assertActive();
    const scope = caller.scope;
    if (scope.kind !== context.scope.kind || scope.projectId !== context.scope.projectId || scope.workspaceId !== context.scope.workspaceId || scope.viewId !== context.scope.viewId) {
        throw new PluginError("PLUGIN_PROJECT_CHANGED");
    }
    return caller;
}
