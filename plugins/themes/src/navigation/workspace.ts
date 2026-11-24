import type { PluginNavigation } from "@infinite-canvas/plugin-sdk";
import { rememberEntries } from "../lib/workspace";

export function workspaceNavigation(hidden: readonly string[], order: readonly string[]): PluginNavigation {
    const ranks = new Map(order.map((id, index) => [id, index]));
    return {
        transform: ({ items }) => {
            rememberEntries(items);
            return items
                .map((item) => ({ ...item, hidden: item.hidden || hidden.includes(item.id) }))
                .sort((a, b) => (ranks.get(a.id) ?? order.length) - (ranks.get(b.id) ?? order.length));
        },
    };
}
