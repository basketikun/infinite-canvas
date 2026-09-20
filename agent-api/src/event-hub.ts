import type { RuntimeEvent } from "./types.js";

type Listener = (event: RuntimeEvent) => void;

export class EventHub {
    private readonly listeners = new Map<string, Set<Listener>>();

    subscribe(conversationId: string, listener: Listener) {
        const listeners = this.listeners.get(conversationId) || new Set<Listener>();
        listeners.add(listener);
        this.listeners.set(conversationId, listeners);
        return () => {
            listeners.delete(listener);
            if (!listeners.size) this.listeners.delete(conversationId);
        };
    }

    publish(event: RuntimeEvent) {
        this.listeners.get(event.conversationId)?.forEach((listener) => listener(event));
    }
}
