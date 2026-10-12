import { useEffect, useRef, useState } from "react";
import { Alert, Button, Modal, Progress, Slider, Switch } from "antd";
import { useTranslation } from "react-i18next";

import { getMediaBlob } from "@/services/file-storage";
import type { VideoFramePosition } from "@/lib/canvas/canvas-video-frame";
import type { CanvasNodeData } from "@/types/canvas";
import { CanvasNodeType } from "@/types/canvas";

type Props = { node: CanvasNodeData | null; open: boolean; onClose: () => void; onCreateResult: (source: CanvasNodeData, output: Blob, extractingAudio: boolean) => Promise<void>; onCaptureFrame: (node: CanvasNodeData, position: VideoFramePosition, currentTime: number) => void };

export function CanvasMediaTrimDialog({ node, open, onClose, onCreateResult, onCaptureFrame }: Props) {
    const { t } = useTranslation();
    const [sourceBlob, setSourceBlob] = useState<Blob | null>(null);
    const [sourceUrl, setSourceUrl] = useState("");
    const [durationSeconds, setDurationSeconds] = useState(0);
    const [timeRange, setTimeRange] = useState<[number, number]>([0, 0]);
    const [previewSeconds, setPreviewSeconds] = useState(0);
    const [wholeSeconds, setWholeSeconds] = useState(true);
    const [action, setAction] = useState<"trim" | "extract-audio">("trim");
    const [loadingSource, setLoadingSource] = useState(false);
    const [trimming, setTrimming] = useState(false);
    const [progress, setProgress] = useState(0);
    const [processingStage, setProcessingStage] = useState<"loading" | "reading" | "extracting" | "processing">("loading");
    const [error, setError] = useState("");
    const videoRef = useRef<HTMLVideoElement>(null);
    const controllerRef = useRef<AbortController | null>(null);
    const trimModuleRef = useRef<typeof import("@/lib/media-trim") | null>(null);
    const wholeDuration = Math.floor(durationSeconds);
    const maxDuration = wholeSeconds ? wholeDuration : durationSeconds;
    const step = wholeSeconds ? 1 : 0.1;
    const rangeIsValid = maxDuration > 0 && timeRange[0] >= 0 && timeRange[0] < timeRange[1] && timeRange[1] <= maxDuration;
    const extractingAudio = node?.type === CanvasNodeType.Video && action === "extract-audio";
    useEffect(() => {
        if (!open || !node) return;
        let active = true;
        let url = "";
        let probe: HTMLMediaElement | null = null;
        setSourceBlob(null);
        setSourceUrl("");
        setDurationSeconds(node.metadata?.durationMs ? node.metadata.durationMs / 1000 : 0);
        setTimeRange([0, node.metadata?.durationMs ? Math.floor(node.metadata.durationMs / 1000) : 0]);
        setPreviewSeconds(0);
        setWholeSeconds(true);
        setAction("trim");
        setError("");
        setLoadingSource(true);
        void (async () => {
            try {
                if (!node.metadata?.storageKey) throw new Error(t("canvas.mediaTrim.sourceUnavailable"));
                const blob = await getMediaBlob(node.metadata.storageKey);
                if (!blob) throw new Error(t("canvas.mediaTrim.sourceUnavailable"));
                if (!active) return;
                setSourceBlob(blob);
                url = URL.createObjectURL(blob);
                setSourceUrl(url);
                probe = document.createElement(node.type === CanvasNodeType.Video ? "video" : "audio");
                probe.preload = "metadata";
                probe.onloadedmetadata = () => {
                    if (!active || !probe || !Number.isFinite(probe.duration)) return;
                    const seconds = Math.max(0, probe.duration);
                    const end = Math.floor(seconds);
                    setDurationSeconds(seconds);
                    setTimeRange([0, end]);
                    setLoadingSource(false);
                };
                probe.onerror = () => { if (active) { if (!node.metadata?.durationMs) setError(t("canvas.mediaTrim.durationFailed")); setLoadingSource(false); } };
                probe.src = url;
            } catch (loadError) {
                if (active) { setError(loadError instanceof Error ? loadError.message : t("canvas.mediaTrim.sourceUnavailable")); setLoadingSource(false); }
            } finally {
                if (active && node.metadata?.durationMs) setLoadingSource(false);
            }
        })();
        return () => {
            active = false;
            controllerRef.current?.abort();
            trimModuleRef.current?.terminateMediaTrim();
            controllerRef.current = null;
            probe?.removeAttribute("src");
            probe?.load();
            if (url) URL.revokeObjectURL(url);
        };
    }, [open, node?.id, node?.metadata?.durationMs, node?.metadata?.storageKey, node?.type, t]);

    const snapTime = (value: number) => wholeSeconds ? Math.round(value) : Math.round(value * 10) / 10;

    const updateRange = (value: number | number[]) => {
        if (!Array.isArray(value) || value.length < 2) return;
        setTimeRange([snapTime(value[0]), snapTime(value[1])]);
        setError("");
    };

    const updateWholeSeconds = (enabled: boolean) => {
        setWholeSeconds(enabled);
        const next: [number, number] = enabled
            ? [Math.min(wholeDuration, Math.round(timeRange[0])), Math.min(wholeDuration, Math.round(timeRange[1]))]
            : [timeRange[0], durationSeconds];
        if (next[0] >= next[1] && (enabled ? wholeDuration >= 1 : durationSeconds > 0)) {
            setTimeRange(enabled ? [0, wholeDuration] : [0, durationSeconds]);
        } else {
            setTimeRange(next);
        }
        setError("");
    };

    const setRangeEndpoint = (endpoint: 0 | 1) => {
        const max = wholeSeconds ? wholeDuration : durationSeconds;
        const current = Math.min(max, snapTime(previewSeconds));
        if (endpoint === 0) {
            setTimeRange([Math.min(current, Math.max(0, timeRange[1] - step)), timeRange[1]]);
        } else {
            setTimeRange([timeRange[0], Math.max(current, Math.min(max, timeRange[0] + step))]);
        }
        setError("");
    };

    const captureFrame = (position: VideoFramePosition) => {
        if (!node || node.type !== CanvasNodeType.Video) return;
        onCaptureFrame(node, position, videoRef.current?.currentTime ?? previewSeconds);
        close();
    };

    const stopTrim = () => {
        controllerRef.current?.abort();
        trimModuleRef.current?.terminateMediaTrim();
        controllerRef.current = null;
        setTrimming(false);
    };

    const runTrim = async () => {
        if (!sourceBlob || !rangeIsValid || !node || trimming) return;
        const controller = new AbortController();
        controllerRef.current = controller;
        setTrimming(true);
        setProgress(0);
        setProcessingStage("loading");
        setError("");
        try {
            const trimModule = await import("@/lib/media-trim");
            trimModuleRef.current = trimModule;
            if (controller.signal.aborted) return;
            const extensionMime: Record<string, string> = { mp4: node.type === CanvasNodeType.Video ? "video/mp4" : "audio/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", opus: "audio/opus", m4a: "audio/mp4", aac: "audio/aac" };
            const titleExtension = node.title.split(".").pop()?.toLowerCase() || "";
            const declaredType = node.metadata?.mimeType;
            const sourceType = sourceBlob.type && sourceBlob.type !== "application/octet-stream" ? sourceBlob.type : declaredType && declaredType !== "application/octet-stream" ? declaredType : extensionMime[titleExtension];
            const source = sourceType && sourceBlob.type !== sourceType ? new Blob([sourceBlob], { type: sourceType }) : sourceBlob;
            const trimmed = await trimModule.trimMedia(source, timeRange[0], timeRange[1], { signal: controller.signal, onProgress: setProgress, onStage: setProcessingStage, mode: extractingAudio ? "extract-audio" : "trim" });
            if (!controller.signal.aborted) {
                await onCreateResult(node, trimmed, extractingAudio);
                if (!controller.signal.aborted) onClose();
            }
        } catch (trimError) {
            if (!controller.signal.aborted) setError(trimError instanceof Error ? trimError.message : t("canvas.mediaTrim.failed"));
        } finally {
            if (controllerRef.current === controller) controllerRef.current = null;
            setTrimming(false);
        }
    };

    const close = () => {
        if (trimming) return;
        stopTrim();
        onClose();
    };

    return (
        <Modal
            title={t(extractingAudio ? "canvas.mediaTrim.extractAudioTitle" : "canvas.mediaTrim.title")}
            open={open}
            centered
            width={640}
            closable={!trimming}
            maskClosable={!trimming}
            keyboard={!trimming}
            onCancel={close}
            destroyOnHidden
            footer={
                <div className="flex justify-end gap-2">
                    <Button disabled={trimming} onClick={close}>{t("common.cancel")}</Button>
                    {trimming ? <Button danger onClick={stopTrim}>{t("canvas.mediaTrim.stop")}</Button> : null}
                    <Button type="primary" disabled={!rangeIsValid || loadingSource || trimming || !sourceBlob} loading={trimming} onClick={() => void runTrim()}>{t(extractingAudio ? "canvas.mediaTrim.extractAudio" : "canvas.mediaTrim.trimAndExport")}</Button>
                </div>
            }
        >
            <div className="space-y-4 pt-2">
                {loadingSource ? <Progress status="active" showInfo={false} /> : null}
                {error ? <Alert type="error" showIcon message={error} /> : null}
                {!loadingSource && durationSeconds > 0 && wholeSeconds && wholeDuration < 1 ? <Alert type="warning" showIcon message={t("canvas.mediaTrim.tooShort")} /> : null}
                {sourceUrl ? node?.type === CanvasNodeType.Video ? (
                    <div className="space-y-2">
                        <video ref={videoRef} src={sourceUrl} controls className="max-h-72 w-full rounded-lg bg-black" onTimeUpdate={(event) => setPreviewSeconds(event.currentTarget.currentTime)} />
                        <div className="flex flex-wrap gap-2">
                            <Button size="small" disabled={loadingSource || trimming} onClick={() => captureFrame("first")}>{t("canvas.videoFrames.first")}</Button>
                            <Button size="small" disabled={loadingSource || trimming} onClick={() => captureFrame("last")}>{t("canvas.videoFrames.last")}</Button>
                            <Button size="small" disabled={loadingSource || trimming} onClick={() => captureFrame("current")}>{t("canvas.videoFrames.current")}</Button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Button size="small" type={action === "trim" ? "primary" : "default"} disabled={trimming} onClick={() => { setAction("trim"); setError(""); }}>{t("canvas.mediaTrim.video")}</Button>
                            <Button size="small" type={action === "extract-audio" ? "primary" : "default"} disabled={trimming} onClick={() => { setAction("extract-audio"); setError(""); }}>{t("canvas.mediaTrim.extractAudio")}</Button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                            <Switch size="small" checked={wholeSeconds} disabled={loadingSource || trimming} onChange={updateWholeSeconds} />
                            <span>{t("canvas.mediaTrim.wholeSeconds")}</span>
                            <span className="ml-auto">{t("canvas.mediaTrim.previewTime", { time: formatSeconds(previewSeconds, !wholeSeconds) })}</span>
                            <Button size="small" disabled={loadingSource || trimming} onClick={() => setRangeEndpoint(0)}>{t("canvas.mediaTrim.setStart")}</Button>
                            <Button size="small" disabled={loadingSource || trimming} onClick={() => setRangeEndpoint(1)}>{t("canvas.mediaTrim.setEnd")}</Button>
                        </div>
                    </div>
                ) : <audio src={sourceUrl} controls className="w-full" /> : null}
                {durationSeconds > 0 ? <>
                    <div className="flex justify-between text-sm"><span>{formatSeconds(timeRange[0], !wholeSeconds)}</span><span>{formatSeconds(timeRange[1], !wholeSeconds)} / {formatSeconds(maxDuration, !wholeSeconds)}</span></div>
                    <Slider range min={0} max={Math.max(step, maxDuration)} step={step} value={timeRange} disabled={maxDuration < step || trimming} onChange={updateRange} />
                </> : null}
                {trimming ? <div className="flex items-center gap-3"><Progress percent={Math.round(progress * 100)} className="flex-1" /><span className="shrink-0 text-xs">{t(`canvas.mediaTrim.${processingStage}`)}</span></div> : null}
            </div>
        </Modal>
    );
}

function formatSeconds(value: number, precise = false) {
    const safeValue = Math.max(0, precise ? Math.round(value * 10) / 10 : Math.floor(value));
    const seconds = Math.floor(safeValue);
    const fraction = precise ? `.${Math.round((safeValue - seconds) * 10)}` : "";
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}${fraction}`;
}
