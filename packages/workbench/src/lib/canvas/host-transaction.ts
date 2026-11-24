import type { CanvasSnapshot, CanvasTransactionOptions, PluginCanvas } from "@infinite-canvas/plugin-sdk";
import type { CanvasDocumentOp } from "@infinite-canvas/shared/canvas/ops/apply";
import { PluginError } from "@infinite-canvas/shared/plugins";

// 仅宿主登记的业务命令可以同步接收已由该命令预先校验的文件；回调不出现于插件公开对象中。
export const hostTransactions = new WeakMap<PluginCanvas, (ops: CanvasDocumentOp[], options?: CanvasTransactionOptions) => CanvasSnapshot>();

export function commitHostTransaction(canvas: PluginCanvas, ops: CanvasDocumentOp[], options?: CanvasTransactionOptions) {
    const commit = hostTransactions.get(canvas);
    if (!commit) throw new PluginError("PLUGIN_INACTIVE");
    return commit(ops, options);
}
