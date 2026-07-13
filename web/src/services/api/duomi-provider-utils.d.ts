export interface DuomiPublicReferenceUrlOptions {
    min?: number;
    max?: number;
    errorMessage?: string;
}

export function duomiRequestUrl(baseUrl: string, path: string, useProxy: boolean, proxyUrl: string): string;
export function duomiRequestHeaders(baseUrl: string, apiKey: string, useProxy: boolean, proxyHeaders?: Record<string, string>, proxyTargetHeader?: string): Record<string, string>;
export function isDuomiRequestTimeout(error: unknown): boolean;
export function duomiPublicReferenceUrls(urls: string[], options?: DuomiPublicReferenceUrlOptions): string[];
export function duomiPublicUrlOrEmpty(value: unknown): string;
