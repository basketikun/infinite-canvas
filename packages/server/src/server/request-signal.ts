import type { Response } from "express";

export function requestSignal(res: Response) {
    const controller = new AbortController();
    res.on("close", () => { if (!res.writableEnded) controller.abort(); });
    return controller.signal;
}
