import { PluginError } from "@infinite-canvas/shared/plugins";

export type PluginCleanup = () => void | Promise<void>;

/**
 * 插件实例拥有的取消信号和资源清理；只管理资源归属，不提供服务容器。
 */
export class PluginScope {
    private controller = new AbortController();
    private cleanups = new Set<() => Promise<void>>();
    private closing?: Promise<void>;
    readonly signal = this.controller.signal;

    assertActive() {
        if (this.signal.aborted) throw new PluginError("PLUGIN_INACTIVE");
    }

    add(cleanup: PluginCleanup) {
        this.assertActive();
        let pending: Promise<void> | undefined;
        const dispose = () => {
            if (!pending) {
                pending = Promise.resolve().then(cleanup);
                void pending.then(() => this.cleanups.delete(dispose), () => {});
            }
            return pending;
        };
        this.cleanups.add(dispose);
        return dispose;
    }

    track<T>(action: () => T): T {
        this.assertActive();
        let complete!: () => void;
        const settled = new Promise<void>((resolve) => { complete = resolve; });
        // 停用时最多等待进行中的调用 10 秒，不响应停止的调用不会卡住停用。
        const release = this.add(() => new Promise<void>((resolve) => { const timer = setTimeout(resolve, 10000); void settled.then(() => { clearTimeout(timer); resolve(); }); }));
        const finish = () => { complete(); void release(); };
        try {
            const result = action();
            if (result && typeof (result as unknown as Promise<unknown>).then === "function") return Promise.resolve(result).finally(finish) as unknown as T;
            finish();
            return result;
        } catch (error) { finish(); throw error; }
    }

    cancel() {
        if (!this.signal.aborted) this.controller.abort(new PluginError("PLUGIN_INACTIVE"));
    }

    close(): Promise<void> {
        if (this.closing) return this.closing;
        this.closing = Promise.resolve().then(async () => {
            const errors: unknown[] = [];
            for (const cleanup of [...this.cleanups].reverse()) {
                try { await cleanup(); } catch (error) { errors.push(error); }
            }
            this.cleanups.clear();
            if (errors.length) throw new AggregateError(errors, "插件退出时清理失败");
        });
        this.cancel();
        return this.closing;
    }
}
