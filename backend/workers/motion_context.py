"""Build the short noisy tail clip used by MiniMax H3 Motion Context.

This worker deliberately has no project imports. It only requires ffmpeg and
Pillow, so an open-source installation can replace it or run it in a venv.
"""
import argparse
import glob
import os
import random
import shutil
import subprocess
import tempfile
from PIL import Image, ImageOps

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("target")
    parser.add_argument("--frames", type=int, default=22)
    parser.add_argument("--alpha", type=float, default=.45)
    parser.add_argument("--alpha-end", type=float, default=.10)
    parser.add_argument("--ramp", type=int, default=3)
    parser.add_argument("--seed", type=int, default=1337)
    args = parser.parse_args()
    if not os.path.isfile(args.source): raise RuntimeError("Motion Context 源视频不存在")
    frames = max(1, min(56, args.frames)); ramp = max(0, min(frames, args.ramp))
    alpha = max(0.0, min(1.0, args.alpha)); alpha_end = max(0.0, min(alpha, args.alpha_end))
    temp = tempfile.mkdtemp(prefix="canvas_h3_motion_context_")
    try:
        pattern = os.path.join(temp, "frame_%05d.png")
        probe = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-show_streams", "-of", "json", args.source], capture_output=True, text=True, check=True)
        import json
        streams = json.loads(probe.stdout).get("streams", [])
        video = next(item for item in streams if item.get("codec_type") == "video")
        count = int(video.get("nb_read_frames") or video.get("nb_frames") or frames)
        actual = min(frames, count)
        start = max(0, count - actual)
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", args.source, "-vf", f"select='gte(n,{start})',setpts=PTS-STARTPTS,fps=24", "-frames:v", str(actual), "-pix_fmt", "rgb24", pattern], check=True)
        palette = [(185,115,215),(115,195,140),(150,148,162),(205,150,192),(138,182,148),(160,120,175)]
        rng = random.Random(args.seed)
        for index, frame in enumerate(sorted(glob.glob(os.path.join(temp, "frame_*.png")))):
            current = alpha
            if ramp and index >= actual - ramp:
                from_end = actual - 1 - index
                current = alpha + (alpha_end - alpha) * (ramp - from_end) / ramp
            with Image.open(frame) as source:
                base = ImageOps.exif_transpose(source).convert("RGB")
                noise = Image.new("RGB", (36, 64))
                noise.putdata([palette[rng.randrange(len(palette))] for _ in range(36 * 64)])
                noise = noise.resize(base.size, Image.Resampling.NEAREST)
                Image.blend(base, noise, max(0, min(1, current))).save(frame, "PNG")
        os.makedirs(os.path.dirname(os.path.abspath(args.target)), exist_ok=True)
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-framerate", "24", "-i", pattern, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", args.target], check=True)
    finally:
        shutil.rmtree(temp, ignore_errors=True)

if __name__ == "__main__": main()
