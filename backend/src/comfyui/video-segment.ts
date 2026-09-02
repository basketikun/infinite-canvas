import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

type Probe = { format?: { duration?: string }; streams?: Array<{ codec_type?: string; duration?: string }> };

export async function splitVideo(source: string, seconds: number, maxSegments: number) {
    const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
    const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
    const probe = await run(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", source]);
    const data = JSON.parse(probe.stdout) as Probe;
    const duration = Number(data.format?.duration || data.streams?.find((item) => item.codec_type === "video")?.duration || 0);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("无法读取源视频时长，无法自动分段");
    const count = Math.max(1, Math.min(maxSegments, Math.ceil(duration / seconds)));
    const directory = await fsTempDirectory();
    const files: string[] = [];
    try {
        for (let index = 0; index < count; index += 1) {
            const start = index * seconds;
            const target = path.join(directory, `segment-${String(index + 1).padStart(4, "0")}.mp4`);
            await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(start), "-t", String(Math.min(seconds, duration - start)), "-i", source, "-map", "0:v:0", "-map", "0:a?", "-c", "copy", "-avoid_negative_ts", "make_zero", target]);
            files.push(target);
        }
        return { files, cleanup: () => rm(directory, { recursive: true, force: true }) };
    } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
    }
}

async function fsTempDirectory() {
    const directory = path.join(os.tmpdir(), `infinite-canvas-h3-segments-${crypto.randomUUID()}`);
    await mkdir(directory, { recursive: true });
    return directory;
}

function run(command: string, args: string[]) {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => { stdout += String(chunk); });
        child.stderr.on("data", (chunk) => { stderr += String(chunk); });
        child.once("error", (error) => reject(new Error(`${command} 启动失败：${error.message}`)));
        child.once("exit", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} 失败（${code}）：${stderr.trim().slice(0, 1000)}`)));
    });
}
