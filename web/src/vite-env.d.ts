/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __APP_RELEASES__: import("@/lib/release").ReleaseInfo[];

interface ImportMetaEnv {
    // Comma-separated local development plugin URLs, refetched on every startup without caching or persistence.
    readonly VITE_DEV_PLUGINS?: string;
    // Optional build-time analytics configuration, with one independent variable per provider.
    // GA4 measurement ID (G-XXXX)
    readonly VITE_ANALYTICS_GA4_ID?: string;
    // Baidu Analytics site ID
    readonly VITE_ANALYTICS_BAIDU_ID?: string;
}

declare module "bun:test" {
    type TestFn = () => void | Promise<void>;
    type Matcher<T> = {
        toBe: (expected: T) => void;
        toEqual: (expected: unknown) => void;
        toBeNull: () => void;
        toThrow: () => void;
        not: {
            toBe: (expected: unknown) => void;
        };
    };

    export const beforeAll: (fn: TestFn) => void;
    export const describe: (name: string, fn: TestFn) => void;
    export const expect: <T>(actual: T) => Matcher<T>;
    export const test: (name: string, fn: TestFn) => void;
}
