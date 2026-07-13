export async function requestDuomiImageBatch({ count, signal, request }) {
    if (signal?.aborted) throw abortError(signal.reason);

    const controller = new AbortController();
    let externalAborted = false;
    let hasFailure = false;
    let firstFailure;
    const forwardAbort = () => {
        externalAborted = true;
        controller.abort(abortError(signal?.reason));
    };
    signal?.addEventListener("abort", forwardAbort, { once: true });

    try {
        if (signal?.aborted) throw abortError(signal.reason);
        const requests = Array.from({ length: Math.max(0, Math.floor(Number(count)) || 0) }, (_, index) =>
            Promise.resolve()
                .then(() => request(index, { signal: controller.signal }))
                .catch((error) => {
                    if (!externalAborted && !hasFailure && !isAbortError(error)) {
                        hasFailure = true;
                        firstFailure = error;
                        controller.abort(abortError());
                    }
                    throw error;
                }),
        );
        const settled = await Promise.allSettled(requests);
        if (hasFailure) throw firstFailure;
        if (externalAborted || signal?.aborted) throw abortError(signal?.reason);
        const rejection = settled.find((result) => result.status === "rejected");
        if (rejection) throw rejection.reason;
        return settled.flatMap((result) => result.value);
    } finally {
        signal?.removeEventListener("abort", forwardAbort);
    }
}

function isAbortError(error) {
    return error instanceof DOMException ? error.name === "AbortError" : Boolean(error && typeof error === "object" && error.name === "AbortError");
}

function abortError(reason) {
    return reason instanceof DOMException && reason.name === "AbortError" ? reason : new DOMException("Aborted", "AbortError");
}
