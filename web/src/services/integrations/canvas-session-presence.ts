const KEEPALIVE_INTERVAL_MS = 10 * 60 * 1000;
const RECONNECT_DELAY_MS = 5000;

export function isManagedCanvasSession(location: Pick<Location, "protocol" | "port">) {
    return location.protocol === "https:" && location.port === "10444";
}

export function startCanvasSessionPresence() {
    if (!isManagedCanvasSession(window.location)) return () => undefined;

    let source: EventSource | null = null;
    let reconnectTimer: number | undefined;
    let stopped = false;

    const authorizeOrRedirect = async () => {
        try {
            const response = await fetch("/_canvas_keepalive", {
                method: "POST",
                credentials: "same-origin",
                cache: "no-store",
            });
            if (response.status === 401 || response.status === 403) {
                window.location.replace("/launch");
                return false;
            }
            return response.ok;
        } catch {
            return false;
        }
    };

    const connect = () => {
        if (stopped) return;
        source?.close();
        source = new EventSource("/_canvas_presence", { withCredentials: true });
        source.onerror = () => {
            source?.close();
            void authorizeOrRedirect().then((authorized) => {
                if (authorized && !stopped) reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
            });
        };
    };

    connect();
    const keepaliveTimer = window.setInterval(() => void authorizeOrRedirect(), KEEPALIVE_INTERVAL_MS);
    return () => {
        stopped = true;
        source?.close();
        window.clearInterval(keepaliveTimer);
        if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    };
}
