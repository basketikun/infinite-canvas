import assert from "node:assert/strict";
import test from "node:test";

const batchModule = await import("../src/services/api/duomi-image-batch.mjs").catch((error) => {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
});
const requestDuomiImageBatch = batchModule.requestDuomiImageBatch;

function runBatch(options) {
    assert.equal(typeof requestDuomiImageBatch, "function", "requestDuomiImageBatch must be exported");
    return requestDuomiImageBatch(options);
}

function trackedAbortSignal() {
    const controller = new AbortController();
    const signal = controller.signal;
    const addEventListener = signal.addEventListener.bind(signal);
    const removeEventListener = signal.removeEventListener.bind(signal);
    let adds = 0;
    let removes = 0;
    signal.addEventListener = (...args) => {
        adds += 1;
        return addEventListener(...args);
    };
    signal.removeEventListener = (...args) => {
        removes += 1;
        return removeEventListener(...args);
    };
    return { controller, signal, counts: () => ({ adds, removes }) };
}

test("runs the requested number of tasks and flattens their images", async () => {
    const calls = [];
    const signals = new Set();

    const images = await runBatch({
        count: 3,
        request: async (index, { signal }) => {
            calls.push(index);
            signals.add(signal);
            return [
                { id: `${index}-a`, dataUrl: `https://cdn.example.com/${index}-a.png` },
                { id: `${index}-b`, dataUrl: `https://cdn.example.com/${index}-b.png` },
            ];
        },
    });

    assert.deepEqual(calls, [0, 1, 2]);
    assert.equal(signals.size, 1);
    assert.deepEqual(
        images.map((image) => image.id),
        ["0-a", "0-b", "1-a", "1-b", "2-a", "2-b"],
    );
});

test("aborts sibling tasks on the first failure and waits for them to settle", async () => {
    const failure = new Error("create failed");
    const started = [];
    const settled = [];

    await assert.rejects(
        runBatch({
            count: 3,
            request: async (index, { signal }) => {
                started.push(index);
                if (index === 0) {
                    await Promise.resolve();
                    throw failure;
                }
                return await new Promise((resolve, reject) => {
                    signal.addEventListener(
                        "abort",
                        () => {
                            setTimeout(() => {
                                settled.push(index);
                                reject(new DOMException("Aborted", "AbortError"));
                            }, 0);
                        },
                        { once: true },
                    );
                });
            },
        }),
        (error) => error === failure,
    );

    assert.deepEqual(started, [0, 1, 2]);
    assert.deepEqual(settled.sort(), [1, 2]);
});

test("forwards external cancellation and removes its listener", async () => {
    const tracked = trackedAbortSignal();
    let aborted = 0;
    const promise = runBatch({
        count: 2,
        signal: tracked.signal,
        request: async (_index, { signal }) =>
            await new Promise((resolve, reject) => {
                signal.addEventListener(
                    "abort",
                    () => {
                        aborted += 1;
                        reject(new DOMException("Aborted", "AbortError"));
                    },
                    { once: true },
                );
            }),
    });

    await Promise.resolve();
    tracked.controller.abort();

    await assert.rejects(promise, (error) => error instanceof DOMException && error.name === "AbortError");
    assert.equal(aborted, 2);
    assert.deepEqual(tracked.counts(), { adds: 1, removes: 1 });
});

test("does not start requests or add listeners when already aborted", async () => {
    const tracked = trackedAbortSignal();
    tracked.controller.abort();
    let requests = 0;

    await assert.rejects(
        runBatch({
            count: 3,
            signal: tracked.signal,
            request: async () => {
                requests += 1;
                return [];
            },
        }),
        (error) => error instanceof DOMException && error.name === "AbortError",
    );

    assert.equal(requests, 0);
    assert.deepEqual(tracked.counts(), { adds: 0, removes: 0 });
});

test("does not miss cancellation while registering the external listener", async () => {
    const tracked = trackedAbortSignal();
    const addEventListener = tracked.signal.addEventListener;
    tracked.signal.addEventListener = (...args) => {
        tracked.controller.abort();
        return addEventListener(...args);
    };
    let requests = 0;

    await assert.rejects(
        runBatch({
            count: 1,
            signal: tracked.signal,
            request: async () => {
                requests += 1;
                return [];
            },
        }),
        (error) => error instanceof DOMException && error.name === "AbortError",
    );

    assert.equal(requests, 0);
    assert.deepEqual(tracked.counts(), { adds: 1, removes: 1 });
});
