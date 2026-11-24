// 只处理工作台自己的插件模块路径。文件仍由发起页面的插件适配器读取。
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
    const prefix = new URL("__plugin_modules__/", self.registration.scope).href;
    if (event.request.method !== "GET" || !event.request.url.startsWith(prefix)) return;
    event.respondWith((async () => {
        const client = await self.clients.get(event.clientId);
        if (!client) return new Response(null, { status: 404 });
        const { port1, port2 } = new MessageChannel();
        const signal = event.request.signal;
        try {
            const blob = await new Promise((resolve, reject) => {
                const abort = () => reject(signal.reason);
                signal.throwIfAborted();
                signal.addEventListener("abort", abort, { once: true });
                port1.onmessage = message => { signal.removeEventListener("abort", abort); resolve(message.data); };
                port1.onmessageerror = () => { signal.removeEventListener("abort", abort); resolve(null); };
                client.postMessage({ type: "plugin-module", url: event.request.url }, [port2]);
            });
            return blob instanceof Blob ? new Response(blob, { headers: { "Content-Type": blob.type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }) : new Response(null, { status: 404 });
        } finally { port1.close(); }
    })());
});
