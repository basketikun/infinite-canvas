const listeners = new Set<() => void>();

export function subscribeCreateSessionsChanged(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function notifyCreateSessionsChanged() {
    for (const listener of listeners) listener();
}
