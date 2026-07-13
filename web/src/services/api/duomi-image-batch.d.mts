export interface DuomiImageBatchOptions<T> {
    count: number;
    signal?: AbortSignal;
    request: (index: number, options: { signal: AbortSignal }) => Promise<T[]>;
}

export function requestDuomiImageBatch<T>(options: DuomiImageBatchOptions<T>): Promise<T[]>;
