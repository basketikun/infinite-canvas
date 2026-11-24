import { playMotion, stopMotion } from "../store/motionPlayback";
import { useSyncExternalStore } from "react";

type Frame = { left: number; top: number; width: number; height: number };
type State = "idle" | "recording" | "sending" | "retry";
let state: State = "idle";
let recorder: MediaRecorder | undefined;
let recorded: Blob | undefined;
let delivery: Promise<void> | undefined;
let finish: (() => Promise<void>) | undefined;
const listeners = new Set<() => void>();

function setState(next: State) {
    state = next;
    for (const listener of listeners) listener();
}
export function useRecordingState() {
    return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state);
}

export function startRecording(view: HTMLCanvasElement, frame: Frame | null, send: (file: Blob) => Promise<void>, duration: number) {
    if (state !== "idle") return;
    const crop = frame ?? { left: 0, top: 0, width: view.clientWidth, height: view.clientHeight };
    const output = document.createElement("canvas");
    output.width = Math.round(crop.width * view.width / view.clientWidth);
    output.height = Math.round(crop.height * view.height / view.clientHeight);
    const left = crop.left / view.clientWidth, top = crop.top / view.clientHeight;
    const width = crop.width / view.clientWidth, height = crop.height / view.clientHeight;
    const context = output.getContext("2d");
    if (!context || !output.width || !output.height) throw new Error("VIEW_UNAVAILABLE");
    let animation = 0;
    function draw() {
        context!.drawImage(view, left * view.width, top * view.height, width * view.width, height * view.height, 0, 0, output.width, output.height);
        animation = requestAnimationFrame(draw);
    }
    const stream = output.captureStream();
    function release() {
        stopMotion();
        cancelAnimationFrame(animation);
        stream.getTracks().forEach(track => track.stop());
    }
    try {
        const active = new MediaRecorder(stream);
        const chunks: Blob[] = [];
        const stopped = new Promise<Blob>((resolve, reject) => {
            active.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
            active.onerror = () => reject(new Error("RECORDING_FAILED"));
            active.onstop = () => {
                release();
                if (chunks.length) resolve(new Blob(chunks, { type: chunks[0].type }));
                else reject(new Error("RECORDING_EMPTY"));
            };
        });
        void stopped.catch(() => { release(); });
        active.start();
        playMotion(duration, true);
        animation = requestAnimationFrame(draw);
        recorder = active;
        finish = async () => {
            if (active.state !== "inactive") active.stop();
            try { recorded = await stopped; }
            catch (error) { discardRecording(); throw error; }
            await send(recorded);
            discardRecording();
        };
        setState("recording");
    } catch (error) { release(); throw error; }
}

export function finishRecording() {
    if (!finish) return Promise.resolve();
    if (delivery) return delivery;
    setState("sending");
    delivery = finish().catch(error => {
        if (recorded) setState("retry");
        throw error;
    }).finally(() => { delivery = undefined; });
    return delivery;
}

export function discardRecording() {
    if (recorder?.state === "recording") recorder.stop();
    recorder = undefined;
    recorded = undefined;
    finish = undefined;
    setState("idle");
}
