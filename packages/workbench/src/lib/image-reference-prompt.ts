import type { ReferenceImage } from "@workbench/types/image";

export function imageReferenceLabel(index: number) {
    return `图片${index + 1}`;
}

export function buildImageReferencePromptText(prompt: string, references: ReferenceImage[]) {
    if (!references.length) return prompt;
    const labels = references.map((_, index) => imageReferenceLabel(index));
    return `参考图片编号：${labels.join("、")}。请按这些编号理解提示词中的图片引用。\n\n${prompt}`;
}
