import { storage } from "@workbench/services/storage/runtime";

/**
 * 本地设置按一秒窗口合并，上一笔尚未写完时只保留最新快照。
 * 使用设置前可提前提交并等待回执，避免读取旧配置。
 */
export function createSettingsWriter<T>(write: (value: T) => Promise<void>) {
    let saved = Promise.resolve();
    let settled = saved;
    let queued: { value: T; start: () => void } | undefined;
    let saving = false;

    return {
        get saving() { return saving; },
        save(value: T) {
            if (queued) {
                queued.value = value;
                return saved;
            }

            const batch = { value, start() {} };
            let ready: Promise<void> | undefined;
            if (storage.kind === "server") {
                ready = new Promise<void>((resolve) => {
                    const timer = setTimeout(resolve, 1000);
                    batch.start = () => { clearTimeout(timer); resolve(); };
                });
                queued = batch;
            }

            saving = true;
            const next = Promise.all([settled, ready]).then(() => {
                if (queued === batch) queued = undefined;
                return write(batch.value);
            }).finally(() => {
                if (saved === next) saving = false;
            });
            saved = next;
            // 失败回执仍交给调用方，下一次编辑可以继续保存。
            settled = saved.catch(() => undefined);
            return saved;
        },
        async flush() {
            let current: Promise<void>;
            do {
                queued?.start();
                current = saved;
                await current;
            } while (current !== saved);
        },
    };
}
