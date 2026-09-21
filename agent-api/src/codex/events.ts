import type { AdapterEvent } from "../runtime.js";
import type { JsonObject } from "../types.js";

export function mapCodexNotification(method: string, params: unknown): AdapterEvent | null {
    const value = isObject(params) ? params : {};
    const item = isObject(value.item) ? value.item : {};
    const itemId = string(value.itemId) || string(item.id);
    const itemType = string(item.type) || string(value.itemType);
    if (method === "item/agentMessage/delta" && itemId) return { type: "assistant.delta", itemId, payload: { delta: string(value.delta) } };
    if (method === "item/completed" && isAgentMessage(itemType) && itemId) return { type: "assistant.completed", itemId, payload: { text: string(item.text) } };
    if ((method === "item/started" || method === "item/mcpToolCall/started") && isTool(itemType) && itemId) {
        return { type: "tool.started", itemId, payload: { toolName: string(item.tool) || string(item.name) || itemType, arguments: item.arguments ?? item.input ?? {} } };
    }
    if ((method === "item/completed" || method === "item/mcpToolCall/completed") && isTool(itemType) && itemId) {
        return { type: "tool.completed", itemId, payload: { toolName: string(item.tool) || string(item.name) || itemType, isError: Boolean(item.error), result: item.result ?? item.output ?? {} } };
    }
    if (method === "item/mcpToolCall/updated" && itemId) return { type: "tool.updated", itemId, payload: { update: value } };
    return null;
}

function isAgentMessage(type: string) {
    return type === "agent_message" || type === "agentMessage";
}

function isTool(type: string) {
    return /mcp|tool/i.test(type);
}

function isObject(value: unknown): value is JsonObject {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function string(value: unknown) {
    return typeof value === "string" ? value : "";
}
