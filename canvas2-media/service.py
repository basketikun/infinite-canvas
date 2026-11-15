import asyncio
import base64
import tempfile
from pathlib import Path

from aiohttp import web


MAX_UPLOAD = 20 * 1024 * 1024


async def read_uploads(request):
    files = []
    fields = {}
    reader = await request.multipart()
    async for part in reader:
        if part.name == "files":
            data = await part.read(decode=False)
            if data:
                if sum(map(len, files)) + len(data) > MAX_UPLOAD:
                    raise web.HTTPBadRequest(text='{"error":"单次视频处理的文件总量不能超过 20 MB"}', content_type="application/json")
                files.append(data)
        elif part.name:
            fields[part.name] = (await part.text()).strip()
    if not files:
        raise web.HTTPBadRequest(text='{"error":"请选择视频文件"}', content_type="application/json")
    return files, fields


async def run_process(*args, timeout):
    process = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        raise web.HTTPGatewayTimeout(text='{"error":"视频处理超时"}', content_type="application/json")
    if process.returncode:
        detail = stderr.decode("utf-8", errors="replace")[-240:]
        raise web.HTTPBadRequest(text=web.json_response({"error": f"ffmpeg 处理失败：{detail}"}).text, content_type="application/json")
    return stdout


async def trim(request):
    files, fields = await read_uploads(request)
    try:
        start = max(0, float(fields.get("start", "0")))
        duration = float(fields.get("duration", "0"))
    except ValueError:
        raise web.HTTPBadRequest(text='{"error":"裁剪时间格式无效"}', content_type="application/json")
    if duration <= 0 or duration > 600:
        raise web.HTTPBadRequest(text='{"error":"裁剪时长须在 0 到 600 秒之间"}', content_type="application/json")
    with tempfile.TemporaryDirectory(prefix="canvas2-trim-") as folder:
        source = Path(folder) / "source.mp4"
        output = Path(folder) / "result.mp4"
        source.write_bytes(files[0])
        await run_process("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", str(start), "-i", str(source), "-t", str(duration), "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", str(output), timeout=300)
        return web.Response(body=output.read_bytes(), content_type="video/mp4", headers={"Content-Disposition": "attachment; filename=trimmed.mp4"})


async def stitch(request):
    files, _ = await read_uploads(request)
    if len(files) < 2 or len(files) > 20:
        raise web.HTTPBadRequest(text='{"error":"拼接需要 2 到 20 个视频"}', content_type="application/json")
    with tempfile.TemporaryDirectory(prefix="canvas2-stitch-") as folder:
        root = Path(folder)
        entries = []
        for index, data in enumerate(files):
            name = f"clip-{index:02d}.mp4"
            (root / name).write_bytes(data)
            entries.append(f"file '{name}'")
        concat = root / "clips.txt"
        concat.write_text("\n".join(entries), encoding="utf-8")
        output = root / "stitched.mp4"
        await run_process("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(concat), "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", str(output), timeout=600)
        return web.Response(body=output.read_bytes(), content_type="video/mp4", headers={"Content-Disposition": "attachment; filename=stitched.mp4"})


async def frames(request):
    files, _ = await read_uploads(request)
    with tempfile.TemporaryDirectory(prefix="canvas2-frames-") as folder:
        root = Path(folder)
        source = root / "source.mp4"
        source.write_bytes(files[0])
        duration_text = (await run_process("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(source), timeout=30)).decode().strip()
        duration = max(0.1, float(duration_text or "10"))
        result = []
        for index in range(4):
            time = duration * index / 4
            image = root / f"frame-{index}.jpg"
            await run_process("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", str(time), "-i", str(source), "-frames:v", "1", "-vf", "scale=640:-1", "-q:v", "4", str(image), timeout=60)
            if image.exists():
                encoded = base64.b64encode(image.read_bytes()).decode("ascii")
                result.append({"time": round(time, 2), "dataUrl": f"data:image/jpeg;base64,{encoded}"})
        return web.json_response({"frames": result, "duration": duration})


async def health(_request):
    return web.json_response({"ok": True})


app = web.Application(client_max_size=MAX_UPLOAD + 1024 * 1024)
app.router.add_get("/health", health)
app.router.add_post("/trim", trim)
app.router.add_post("/stitch", stitch)
app.router.add_post("/frames", frames)
web.run_app(app, host="127.0.0.1", port=9030, access_log=None)
