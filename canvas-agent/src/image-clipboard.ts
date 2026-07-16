import { spawn } from "node:child_process";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const POWERSHELL_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd())
$stream = [IO.MemoryStream]::new($bytes)
$source = [Drawing.Image]::FromStream($stream)
$image = [Drawing.Bitmap]::new($source)
$source.Dispose()
$stream.Dispose()
$copied = $false
try {
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        try {
            [Windows.Forms.Clipboard]::SetDataObject($image, $true)
            $copied = $true
            break
        } catch {
            Start-Sleep -Milliseconds 100
        }
    }
} finally {
    $image.Dispose()
}
if (-not $copied) { throw "Windows clipboard is busy" }
`;

export function copyPngToClipboard(png: Buffer) {
    if (process.platform !== "win32") throw new Error("图片剪贴板兼容模式仅支持 Windows");
    if (!png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) throw new Error("请求内容不是有效的 PNG 图片");

    return new Promise<void>((resolve, reject) => {
        const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-Command", POWERSHELL_SCRIPT], { windowsHide: true });
        let stderr = "";
        let settled = false;
        const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            error ? reject(error) : resolve();
        };
        const timer = setTimeout(() => {
            child.kill();
            finish(new Error("写入 Windows 剪贴板超时"));
        }, 15_000);

        child.stderr.on("data", (chunk) => (stderr += String(chunk).slice(0, 2_000)));
        child.on("error", (error) => finish(error));
        child.on("close", (code) => finish(code === 0 ? undefined : new Error(stderr.trim() || "写入 Windows 剪贴板失败")));
        child.stdin.end(png.toString("base64"));
    });
}
