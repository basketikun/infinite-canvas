import i18n from "@/i18n";
import { ImageReadError } from "@/services/image-storage";
import { decodeChannelModel, normalizeChannelConcurrency, normalizeImageModelTargets, type AiConfig } from "@/stores/use-config-store";

type ScheduledImageResult<T> = { value: T; target: string };
type ScheduleImageGenerationOptions = {
    signal?: AbortSignal;
    preferredTarget?: string;
    fallbackOnError?: boolean;
};
type PendingJob<T> = {
    config: AiConfig;
    targets: string[];
    preferredTarget?: string;
    signal?: AbortSignal;
    run: (target: string) => Promise<T>;
    resolve: (result: ScheduledImageResult<T>) => void;
    reject: (error: unknown) => void;
    started: boolean;
};

class ImageGenerationAttemptError {
    constructor(
        readonly target: string,
        readonly cause: unknown,
    ) {}
}

class ImageGenerationScheduler {
    private pending: PendingJob<unknown>[] = [];
    private activeByChannel = new Map<string, number>();
    private cursor = 0;

    schedule<T>(config: AiConfig, targets: string[], run: (target: string) => Promise<T>, options: ScheduleImageGenerationOptions = {}) {
        const normalizedTargets = normalizeImageModelTargets(targets[0] || config.imageModel, targets, config.channels);
        if (!normalizedTargets.length) return Promise.reject(noImageChannelError());
        const { signal } = options;
        if (signal?.aborted) return Promise.reject(abortError());
        return new Promise<ScheduledImageResult<T>>((resolve, reject) => {
            const preferredTarget = normalizedTargets.includes(options.preferredTarget || "") ? options.preferredTarget : undefined;
            const job: PendingJob<T> = { config, targets: normalizedTargets, preferredTarget, signal, run, resolve, reject, started: false };
            const abort = () => {
                if (job.started) return;
                const index = this.pending.indexOf(job as PendingJob<unknown>);
                if (index >= 0) this.pending.splice(index, 1);
                reject(abortError());
            };
            signal?.addEventListener("abort", abort, { once: true });
            const wrappedResolve = job.resolve;
            const wrappedReject = job.reject;
            job.resolve = (value) => {
                signal?.removeEventListener("abort", abort);
                wrappedResolve(value);
            };
            job.reject = (error) => {
                signal?.removeEventListener("abort", abort);
                wrappedReject(error);
            };
            this.pending.push(job as PendingJob<unknown>);
            this.dispatch();
        });
    }

    private dispatch() {
        let dispatched = true;
        while (dispatched) {
            dispatched = false;
            for (let index = 0; index < this.pending.length; index += 1) {
                const job = this.pending[index];
                if (job.signal?.aborted) {
                    this.pending.splice(index, 1);
                    index -= 1;
                    job.reject(abortError());
                    continue;
                }
                const target = this.pickTarget(job);
                if (!target) continue;
                this.pending.splice(index, 1);
                this.start(job, target);
                dispatched = true;
                break;
            }
        }
    }

    private pickTarget(job: PendingJob<unknown>) {
        // A preferred job waits for its selected channel; fallback starts only after an actual request failure.
        if (job.preferredTarget) {
            const channelId = decodeChannelModel(job.preferredTarget)?.channelId;
            const channel = job.config.channels.find((item) => item.id === channelId);
            if (!channelId || !channel) return null;
            const active = this.activeByChannel.get(channelId) || 0;
            return active < normalizeChannelConcurrency(channel.maxConcurrency) ? { target: job.preferredTarget, channelId } : null;
        }
        const candidates = job.targets.flatMap((target, index) => {
            const channelId = decodeChannelModel(target)?.channelId;
            const channel = job.config.channels.find((item) => item.id === channelId);
            if (!channelId || !channel) return [];
            const active = this.activeByChannel.get(channelId) || 0;
            const capacity = normalizeChannelConcurrency(channel.maxConcurrency);
            return active < capacity ? [{ target, channelId, active, capacity, order: (index - this.cursor + job.targets.length) % job.targets.length }] : [];
        });
        candidates.sort((a, b) => a.active / a.capacity - b.active / b.capacity || a.order - b.order);
        const picked = candidates[0];
        if (!picked) return null;
        this.cursor = (job.targets.indexOf(picked.target) + 1) % job.targets.length;
        return picked;
    }

    private start(job: PendingJob<unknown>, target: { target: string; channelId: string }) {
        job.started = true;
        this.activeByChannel.set(target.channelId, (this.activeByChannel.get(target.channelId) || 0) + 1);
        Promise.resolve()
            .then(() => job.run(target.target))
            .then(
                (value) => job.resolve({ value, target: target.target }),
                (error) => job.reject(new ImageGenerationAttemptError(target.target, error)),
            )
            .finally(() => {
                const active = (this.activeByChannel.get(target.channelId) || 1) - 1;
                if (active > 0) this.activeByChannel.set(target.channelId, active);
                else this.activeByChannel.delete(target.channelId);
                this.dispatch();
            });
    }
}

const scheduler = new ImageGenerationScheduler();

export async function scheduleImageGeneration<T>(config: AiConfig, targets: string[], run: (target: string) => Promise<T>, options: ScheduleImageGenerationOptions = {}) {
    let remainingTargets = normalizeImageModelTargets(targets[0] || config.imageModel, targets, config.channels);
    let preferredTarget = remainingTargets.includes(options.preferredTarget || "") ? options.preferredTarget : undefined;
    while (remainingTargets.length) {
        try {
            return await scheduler.schedule(config, remainingTargets, run, { signal: options.signal, preferredTarget });
        } catch (error) {
            if (!(error instanceof ImageGenerationAttemptError)) throw error;
            // A local read failure repeats on every channel, so surface it instead of turning it into one real request per channel.
            if (!options.fallbackOnError || isAbortError(error.cause) || error.cause instanceof ImageReadError) throw error.cause;
            remainingTargets = remainingTargets.filter((target) => target !== error.target);
            preferredTarget = undefined;
            if (!remainingTargets.length) throw error.cause;
        }
    }
    throw noImageChannelError();
}

function noImageChannelError() {
    return new Error(i18n.t("apiErrors.noImageChannel"));
}

function abortError() {
    return new DOMException("Aborted", "AbortError");
}

function isAbortError(error: unknown) {
    return error instanceof Error && error.name === "AbortError";
}
