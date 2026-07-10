import type { IncomingMessage, ServerResponse } from "node:http";

export const AI_PROXY_PATH: string;
export const AI_PROXY_TARGET_HEADER: string;

export function createAiProxyHandler(options?: { proxyBasePath?: string; allowLocal?: boolean }): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
export function resolveProxyTargetUrl(targetBaseUrl: string, requestPath: string, proxyBasePath?: string, query?: string): URL;
export function validateTargetUrl(targetUrl: URL, options?: { allowLocal?: boolean }): Promise<void>;
export function createForwardHeaders(headers: IncomingMessage["headers"]): Record<string, string>;
