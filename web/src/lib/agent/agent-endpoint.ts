export const LOCAL_AGENT_ENDPOINT = "http://127.0.0.1:17371";

export function getAgentProxyEndpoint() {
    if (typeof window === "undefined" || !import.meta.env.DEV) return "";
    if (["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) return "";
    return `${window.location.origin}/canvas-agent`;
}

export function getDefaultAgentEndpoint() {
    return getAgentProxyEndpoint() || LOCAL_AGENT_ENDPOINT;
}
