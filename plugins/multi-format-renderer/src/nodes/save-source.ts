import type { CanvasNodeContext } from "@infinite-canvas/plugin-sdk";

/** React 不等待输入事件返回的 Promise；写入拒绝时在仍打开的编辑框提示。 */
export function saveSource(ctx: CanvasNodeContext, input: HTMLTextAreaElement) {
    input.setCustomValidity("");
    void ctx.updateMetadata({ content: input.value }).catch((error) => {
        if (ctx.scope.signal.aborted || !input.isConnected) return;
        console.error("[multi-format-renderer] save source", error);
        input.setCustomValidity("内容未能保存，请重新编辑。");
        input.reportValidity();
    });
}
