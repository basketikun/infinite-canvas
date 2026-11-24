import type { z } from "zod";
import type { PluginScopeKind } from "@infinite-canvas/shared/plugins";

/** 作用域由宿主按点固定；插件自己定义的点统一为 application。 */
export type ExtensionPoint<T> = Readonly<{ id: string; scope: PluginScopeKind; schema: z.ZodType<T> }>;
export type Contribution<T> = { point: ExtensionPoint<T>; id: string; value: T };
export type CapabilityCallContext = { readonly callerId: string; readonly callerSignal: AbortSignal; readonly bindingSignal: AbortSignal; readonly signal: AbortSignal; readonly scope: ScopeBinding };
export type Capability<T extends object> = Readonly<{
    id: string;
    scope: PluginScopeKind;
    methods: { [K in keyof T]: T[K] extends (input: infer I, ...args: any[]) => infer O ? { input: z.ZodType<I>; output: z.ZodType<Awaited<O>> } : never };
}>;
export type CapabilityHandle<T extends object> = { readonly [K in keyof T]: T[K] extends (input: infer I, ...args: any[]) => infer O ? (input: I) => O : never };

/**
 * 消费者实际持有的生命周期；工作区页面的视图不要求虚构项目。
 */
export type ScopeBinding = Readonly<{
    kind: PluginScopeKind;
    signal: AbortSignal;
    workspaceId?: string;
    projectId?: string;
    viewId?: string;
}>;

/**
 * 异构声明仅在容器中擦除类型，作者入口保留点和值之间的类型推导。
 */
export type PluginDeclarations = {
    extensionPoints?: ExtensionPoint<any>[];
    contributions?: Contribution<any>[];
};

export type RegisteredContribution<T> = Readonly<{
    id: string;
    point: string;
    pluginId: string;
    instanceId: number;
    value: T;
    signal: AbortSignal;
    assertActive: () => void;
}>;

export interface PluginExtensions {
    define<T>(point: ExtensionPoint<T>): () => void;
    contribute<T>(point: ExtensionPoint<T>, contribution: { id: string; value: T }): () => void;
    query<T>(point: ExtensionPoint<T>, scope: ScopeBinding): readonly RegisteredContribution<T>[];
    subscribe<T>(point: ExtensionPoint<T>, scope: ScopeBinding, listener: () => void): () => void;
    track<T>(entry: RegisteredContribution<unknown>, action: () => T): T;
}

export interface PluginCapabilities {
    get<T extends object>(contract: Capability<T>, scope: ScopeBinding): CapabilityHandle<T> | null;
}

/** 插件自己的扩展点，只需要 id 与 schema。 */
export function defineExtensionPoint<T>(definition: { id: string; schema: z.ZodType<T> }): ExtensionPoint<T> {
    return Object.freeze({ ...definition, scope: "application" });
}

/** 宿主内部使用，按点固定作用域。 */
export function defineHostPoint<T>(id: string, scope: PluginScopeKind, schema: z.ZodType<T>): ExtensionPoint<T> {
    return Object.freeze({ id, scope, schema });
}

export function contribute<T>(point: ExtensionPoint<T>, contribution: { id: string; value: T }): Contribution<T> {
    return { point, ...contribution };
}

export function defineCapability<T extends object>(definition: Capability<T>): Capability<T> {
    return Object.freeze({ ...definition, methods: Object.freeze({ ...definition.methods }) });
}
