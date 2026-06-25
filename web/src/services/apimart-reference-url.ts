export type ApimartReferenceImage = {
    url?: string;
    dataUrl?: string;
    sourceUrl?: string;
};

export const apimartImageUploadPath = "/uploads/images";

export function directApimartReferenceImageUrl(image: ApimartReferenceImage) {
    const directUrl = image.sourceUrl || image.url || image.dataUrl || "";
    return /^https?:\/\//i.test(directUrl) || directUrl.startsWith("asset://") ? directUrl : "";
}
