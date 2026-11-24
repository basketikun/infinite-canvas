export type NetworkAdapter = {
    /**
     * 决定当前入口是否展示浏览器专用代理设置。
     */
    kind: "browser" | "server";
    /**
     * 将外部地址映射到当前入口的请求路径，本地素材地址保持不变。
     */
    url: (url: string, mode?: "sync") => string;
};

export let network: NetworkAdapter;

export function initializeNetwork(adapter: NetworkAdapter) {
    if (network) throw new Error("NETWORK_ALREADY_INITIALIZED");
    network = adapter;
}
