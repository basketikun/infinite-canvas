import { saveAs } from "file-saver";

export async function copyOrDownloadMedia(blob: Blob, filename: string): Promise<"copied" | "downloaded"> {
    try {
        if (typeof ClipboardItem !== "undefined" && typeof ClipboardItem.supports === "function" && ClipboardItem.supports(blob.type) && navigator.clipboard?.write) {
            await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
            return "copied";
        }
    } catch {
        // Clipboard support and permissions vary by browser; download the same file instead.
    }
    saveAs(blob, filename);
    return "downloaded";
}
