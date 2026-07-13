export interface DuomiLifecycleRequestOptions {
    signal?: AbortSignal;
    timeout: number;
}

export interface DuomiImageLifecycleOptions {
    model: string;
    create: (options: DuomiLifecycleRequestOptions) => Promise<unknown>;
    poll: (taskId: string, options: DuomiLifecycleRequestOptions) => Promise<unknown>;
    wait: (ms: number, signal?: AbortSignal) => Promise<void>;
    now: () => number;
    makeId: () => string;
    signal?: AbortSignal;
    interval?: number;
    maxAttempts?: number;
    timeout?: number;
}

export function runDuomiImageLifecycle(options: DuomiImageLifecycleOptions): Promise<Array<{ id: string; dataUrl: string }>>;
