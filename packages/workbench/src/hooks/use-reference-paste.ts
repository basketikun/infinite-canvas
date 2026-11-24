import { useEffect, useRef } from "react";

/** 页面内粘贴图片时转成参考图，避免浏览器把原图直接贴进提示词输入框。 */
export function useReferencePaste(addFiles: (files: File[]) => void, pasteImage: () => void) {
    // 回调每次渲染都会变化，用 ref 保存最新的，粘贴监听只注册一次。
    const handlers = useRef({ addFiles, pasteImage });
    handlers.current = { addFiles, pasteImage };
    useEffect(() => {
        const onPaste = (event: ClipboardEvent) => {
            const data = event.clipboardData;
            if (!data) return;
            const files = Array.from(data.files).filter((file) => file.type.startsWith("image/"));
            if (files.length) {
                event.preventDefault();
                handlers.current.addFiles(files);
                return;
            }
            // 系统截图只提供位图时粘贴事件拿不到文件，改用异步剪贴板读取。
            if (data.types.includes("text/plain") || data.types.includes("text/html")) return;
            event.preventDefault();
            handlers.current.pasteImage();
        };
        document.addEventListener("paste", onPaste);
        return () => document.removeEventListener("paste", onPaste);
    }, []);
}
