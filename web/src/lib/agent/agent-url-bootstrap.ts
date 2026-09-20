export function hasAgentUrlBootstrap(hash: string) {
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    return params.has("agentUrl") || params.has("agentToken");
}

export function isValidAgentEndpoint(value: string) {
    const endpoint = value.trim();
    if (!endpoint) return false;
    if (endpoint.startsWith("/") && !endpoint.startsWith("//")) return true;
    try {
        const parsed = new URL(endpoint);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}

export function readAgentUrlBootstrap(hash: string) {
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    if (!params.has("agentUrl") && !params.has("agentToken")) return null;
    const url = params.get("agentUrl")?.trim() || "";
    const token = params.get("agentToken")?.trim() || "";
    params.delete("agentUrl");
    params.delete("agentToken");
    const remaining = params.toString();
    return { url, token, remainingHash: remaining ? `#${remaining}` : "" };
}
