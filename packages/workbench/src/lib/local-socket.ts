// 本地服务推送通道。WebSocket 不占浏览器对同一地址的 6 个普通连接，多开页面时不会堵住其他请求。
// 断开后 3 秒重连，与原 EventSource 的默认重连间隔一致。
export function openLocalSocket(path: string, onMessage: (type: string, data: any) => void, onClose: () => void) {
    let socket: WebSocket;
    let timer: ReturnType<typeof setTimeout>;
    let closed = false;
    const connect = () => {
        socket = new WebSocket(`ws://${location.host}${path}`);
        socket.onmessage = (event) => {
            const message = JSON.parse(event.data) as { type: string; data: unknown };
            onMessage(message.type, message.data);
        };
        socket.onclose = () => {
            if (closed) return;
            onClose();
            timer = setTimeout(connect, 3000);
        };
    };
    connect();
    return () => {
        closed = true;
        clearTimeout(timer);
        socket.close();
    };
}
