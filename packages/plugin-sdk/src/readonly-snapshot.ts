export type ReadonlySnapshot<T> = T extends object ? { readonly [K in keyof T]: ReadonlySnapshot<T[K]> } : T;

const snapshots = new WeakMap<object, object>();

/** 仅识别由本工具构造并递归冻结的快照，不把普通浅冻结对象视为安全快照。 */
export function isReadonlySnapshot(value: object) {
    return snapshots.get(value) === value;
}

/**
 * 画布数据按不可变更新维护；复用未变化分支，隔离插件持有的读取引用。
 */
export function readonlySnapshot<T>(value: T): ReadonlySnapshot<T> {
    if (value === null || typeof value !== "object") return value as ReadonlySnapshot<T>;
    const cached = snapshots.get(value);
    if (cached) return cached as ReadonlySnapshot<T>;
    const snapshot = Object.freeze(Array.isArray(value)
        ? value.map((item) => readonlySnapshot(item))
        : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, readonlySnapshot(item)])));
    snapshots.set(value, snapshot);
    snapshots.set(snapshot, snapshot);
    return snapshot as ReadonlySnapshot<T>;
}
