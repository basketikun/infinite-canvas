import { PluginError, pluginErrorMessages, type PluginAdapter, type PluginErrorCode } from "@infinite-canvas/shared/plugins";

export function createHttpPlugins(): PluginAdapter {
    const request = async <T>(route: string, init?: RequestInit): Promise<T> => {
        const response = await fetch(`/api/plugins${route}`, init);
        if (!response.ok) {
            const result = await response.json();
            const code: PluginErrorCode = Object.hasOwn(pluginErrorMessages, result.code) ? result.code : "PLUGIN_OPERATION_FAILED";
            throw new PluginError(code);
        }
        return response.json();
    };
    const json = (method: string, body: unknown, signal?: AbortSignal): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
    const binary = (body: Uint8Array, signal?: AbortSignal): RequestInit => ({ method: "POST", headers: { "content-type": "application/octet-stream" }, body: new Uint8Array(body), signal });
    return {
        list: () => request(""),
        config: () => request("/config"),
        index: () => request("/index"),
        localDirectory: () => request("/local-directory"),
        configure: (config) => request("/config", json("PUT", config)),
        install: (spec, signal) => request("/install", json("POST", spec, signal)),
        inspectPackage: (bytes) => request("/package/inspect", binary(bytes)),
        installPackage: (bytes, signal) => request("/package", binary(bytes, signal)),
        remove: (id) => request(`/${encodeURIComponent(id)}`, { method: "DELETE" }),
        enable: (id, enabled) => request(`/${encodeURIComponent(id)}/enabled`, json("PUT", { enabled })),
        source: (id, version, generation) => request(`/${encodeURIComponent(id)}/source?${new URLSearchParams({ version, ...(generation && { generation }) })}`),
        asset: (id, version, kind, generation) => request(`/${encodeURIComponent(id)}/assets/${kind}?${new URLSearchParams({ version, ...(generation && { generation }) })}`),
        clientBase: (record, instance) => new URL(`/api/plugins/${encodeURIComponent(record.package.infiniteCanvas.id)}/files/${encodeURIComponent(record.package.version)}/${encodeURIComponent(record.clientFiles!.generation)}/${instance}/`, location.origin).href,
    };
}
