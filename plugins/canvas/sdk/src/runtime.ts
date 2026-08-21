// 运行时桥接:所有对宿主 React 的访问都惰性读取全局运行时,
// 保证插件与画布共用同一份 React(不打包第二份),且不在模块顶层触碰运行时
// (宿主 loader 会先 import 插件模块、再设置运行时)。

import type * as React from "react";

import type { PluginRuntime } from "./types";

type RuntimeGlobal = { InfiniteCanvasRuntime?: PluginRuntime };

/** 取宿主注入的插件运行时(含 React、事件总线、injectCSS 等)。 */
export function getRuntime(): PluginRuntime {
    const runtime = (globalThis as unknown as RuntimeGlobal).InfiniteCanvasRuntime;
    if (!runtime) {
        throw new Error("[plugin-sdk] DSH FreeCanvas 运行时未就绪:请在画布宿主中加载本插件");
    }
    return runtime;
}

/** 取宿主的 React 实例。仅在渲染/hook 调用时(运行时已就绪)使用。 */
export function getReact(): typeof React {
    return getRuntime().React as unknown as typeof React;
}

// --- 类型完整的 hooks 转发:签名取自 @types/react,运行时转发到宿主 React ---
// 这样插件作者可以直接 `import { useState } from "@infinite-canvas/plugin-sdk"`,
// 无需再从 runtime 里解构 React。

export const useState: typeof React.useState = ((...args: unknown[]) => (getReact().useState as (...a: unknown[]) => unknown)(...args)) as typeof React.useState;
export const useEffect: typeof React.useEffect = ((...args: unknown[]) => (getReact().useEffect as (...a: unknown[]) => unknown)(...args)) as typeof React.useEffect;
export const useLayoutEffect: typeof React.useLayoutEffect = ((...args: unknown[]) => (getReact().useLayoutEffect as (...a: unknown[]) => unknown)(...args)) as typeof React.useLayoutEffect;
export const useMemo: typeof React.useMemo = ((...args: unknown[]) => (getReact().useMemo as (...a: unknown[]) => unknown)(...args)) as typeof React.useMemo;
export const useCallback: typeof React.useCallback = ((...args: unknown[]) => (getReact().useCallback as (...a: unknown[]) => unknown)(...args)) as typeof React.useCallback;
export const useRef: typeof React.useRef = ((...args: unknown[]) => (getReact().useRef as (...a: unknown[]) => unknown)(...args)) as typeof React.useRef;
export const useReducer: typeof React.useReducer = ((...args: unknown[]) => (getReact().useReducer as (...a: unknown[]) => unknown)(...args)) as typeof React.useReducer;
export const useContext: typeof React.useContext = ((...args: unknown[]) => (getReact().useContext as (...a: unknown[]) => unknown)(...args)) as typeof React.useContext;
export const useId: typeof React.useId = ((...args: unknown[]) => (getReact().useId as (...a: unknown[]) => unknown)(...args)) as typeof React.useId;
