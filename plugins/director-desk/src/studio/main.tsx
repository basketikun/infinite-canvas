import { createRoot } from "react-dom/client";
import App from "./App";
import { openSession, saveAndClose } from "./editor/io/session";

function connect(event: MessageEvent) {
    if (event.source !== parent || event.data !== "director-desk:open" || !event.ports[0]) return;
    window.removeEventListener("message", connect);
    const root = createRoot(document.getElementById("root")!);
    const port = event.ports[0];
    void openSession(port).then(() => root.render(<App />)).catch(() => root.render(<>
        <p role="alert">场景读取失败，请关闭导演台后重试。</p>
        <button type="button" className="desk-text-action" onClick={() => void saveAndClose()}>关闭导演台</button>
    </>));
}
window.addEventListener("message", connect);
