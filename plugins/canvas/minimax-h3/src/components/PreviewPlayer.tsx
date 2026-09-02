import type { CanvasNodeContext } from "@infinite-canvas/plugin-sdk";

export function PreviewPlayer({ ctx, url, kind = "video" }: { ctx: CanvasNodeContext; url: string; kind?: "image" | "video" | "audio" }) {
    if (!url) return <div className="minimax-player-empty">连接视频和角色参考图</div>;
    if (kind === "image") return <img src={url} alt="H3 reference" style={{ width: "100%", height: "100%", objectFit: "contain" }} />;
    if (kind === "audio") return <audio src={url} controls />;
    return <video src={url} controls muted playsInline onTimeUpdate={(event) => ctx.updateMetadata({ playhead: event.currentTarget.currentTime })} />;
}
