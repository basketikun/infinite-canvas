import { uploadImage, type UploadedImage } from "@workbench/services/image-storage";

/** 上传图片得到可写入节点的图片信息；本地内容保存为新键，已保存的图片复用原键。 */
export async function prepareImage(input: string | Blob, signal: AbortSignal): Promise<Omit<UploadedImage, "url"> & { url?: string }> {
    const { url, ...image } = await uploadImage(input, { signal });
    if (!url.startsWith("blob:")) return { ...image, url };
    URL.revokeObjectURL(url);
    return image;
}
