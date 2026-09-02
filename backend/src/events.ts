export type BackendEvent = {
    id: string;
    type: string;
    entityId?: string;
    revision?: number;
    createdAt: string;
    payload: unknown;
};

type Listener = (event: BackendEvent) => void;

/** 进程内实时通知总线；REST 快照仍是重连后的权威数据源。 */
export class BackendEventBus {
    private sequence = 0;
    private readonly history: BackendEvent[] = [];
    private readonly listeners = new Set<Listener>();

    publish(input: Omit<BackendEvent, "id" | "createdAt">): BackendEvent {
        const event = { ...input, id: String(++this.sequence), createdAt: new Date().toISOString() };
        this.history.push(event);
        if (this.history.length > 1000) this.history.shift();
        for (const listener of this.listeners) listener(event);
        return event;
    }

    since(lastEventId?: string): BackendEvent[] {
        const after = Number(lastEventId || 0);
        return Number.isFinite(after) ? this.history.filter((event) => Number(event.id) > after) : [];
    }

    subscribe(listener: Listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}
