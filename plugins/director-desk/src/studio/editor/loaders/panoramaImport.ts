import { keepFile } from "../io/session";
const PANORAMA_IMAGE_EXTENSION_RE = /\.(jpe?g|png|webp)$/i;
const PANORAMA_RATIO = 2;
const PANORAMA_RATIO_TOLERANCE = 0.02;
const PANORAMA_MIN_WIDTH = 2048;
const PANORAMA_MAX_WIDTH = 4096;
const PANORAMA_SEAM_BLEND_RATIO = 0.035;
const PANORAMA_SEAM_MIN_WIDTH = 32;
const PANORAMA_SEAM_MAX_WIDTH = 192;
const PANORAMA_POLE_BLEND_RATIO = 0.16;
const PANORAMA_POLE_MIN_HEIGHT = 48;
const PANORAMA_POLE_MAX_HEIGHT = 220;

type PanoramaImageSource = {
  width: number;
  height: number;
  close?: () => void;
};

type ContainPlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function isPanoramaRatio(width: number, height: number) {
  return Math.abs(width / height - PANORAMA_RATIO) <= PANORAMA_RATIO_TOLERANCE;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundToEven(value: number) {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function getContainPlacement(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): ContainPlacement {
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
}

function getCoverPlacement(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): ContainPlacement {
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
}

function getSeamBlendWidth(width: number) {
  return Math.max(PANORAMA_SEAM_MIN_WIDTH, Math.min(PANORAMA_SEAM_MAX_WIDTH, Math.round(width * PANORAMA_SEAM_BLEND_RATIO)));
}

function getPoleBlendHeight(height: number) {
  return Math.max(PANORAMA_POLE_MIN_HEIGHT, Math.min(PANORAMA_POLE_MAX_HEIGHT, Math.round(height * PANORAMA_POLE_BLEND_RATIO)));
}

function averageRowColor(pixels: Uint8ClampedArray, width: number, row: number) {
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;

  for (let x = 0; x < width; x += 1) {
    const index = (row * width + x) * 4;
    red += pixels[index] ?? 0;
    green += pixels[index + 1] ?? 0;
    blue += pixels[index + 2] ?? 0;
    alpha += pixels[index + 3] ?? 0;
  }

  return [
    Math.round(red / width),
    Math.round(green / width),
    Math.round(blue / width),
    Math.round(alpha / width),
  ] as const;
}

function blendPanoramaSeamPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  seamWidth: number
) {
  const next = new Uint8ClampedArray(pixels);
  const maxDistance = Math.max(1, seamWidth - 1);

  for (let y = 0; y < height; y += 1) {
    for (let distance = 0; distance < seamWidth; distance += 1) {
      const leftIndex = (y * width + distance) * 4;
      const rightIndex = (y * width + (width - 1 - distance)) * 4;
      const blend = distance / maxDistance;

      for (let channel = 0; channel < 4; channel += 1) {
        const left = pixels[leftIndex + channel] ?? 0;
        const right = pixels[rightIndex + channel] ?? 0;
        const averaged = Math.round((left + right) / 2);
        next[leftIndex + channel] = Math.round(averaged + (left - averaged) * blend);
        next[rightIndex + channel] = Math.round(averaged + (right - averaged) * blend);
      }
    }
  }

  return next;
}

function softenPanoramaPolePixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  poleBlendHeight: number
) {
  const next = new Uint8ClampedArray(pixels);
  const topReferenceRow = Math.min(height - 1, poleBlendHeight);
  const bottomReferenceRow = Math.max(0, height - 1 - poleBlendHeight);
  const topPoleColor = averageRowColor(pixels, width, topReferenceRow);
  const bottomPoleColor = averageRowColor(pixels, width, bottomReferenceRow);
  const maxDistance = Math.max(1, poleBlendHeight - 1);

  for (let y = 0; y < poleBlendHeight; y += 1) {
    const blend = Math.pow(y / maxDistance, 1.35);

    for (let x = 0; x < width; x += 1) {
      const topIndex = (y * width + x) * 4;
      const bottomIndex = ((height - 1 - y) * width + x) * 4;

      for (let channel = 0; channel < 4; channel += 1) {
        const topOriginal = pixels[topIndex + channel] ?? 0;
        const bottomOriginal = pixels[bottomIndex + channel] ?? 0;
        next[topIndex + channel] = Math.round(topPoleColor[channel] + (topOriginal - topPoleColor[channel]) * blend);
        next[bottomIndex + channel] = Math.round(
          bottomPoleColor[channel] + (bottomOriginal - bottomPoleColor[channel]) * blend
        );
      }
    }
  }

  return next;
}

function getColumnTransitionScore(pixels: Uint8ClampedArray, width: number, height: number, seamColumn: number) {
  const topGuard = Math.max(0, Math.min(height - 1, Math.round(height * 0.08)));
  const bottomGuard = Math.max(topGuard + 1, height - topGuard);
  let score = 0;

  for (let y = topGuard; y < bottomGuard; y += 1) {
    const leftIndex = (y * width + (seamColumn - 1)) * 4;
    const rightIndex = (y * width + seamColumn) * 4;

    score += Math.abs((pixels[leftIndex] ?? 0) - (pixels[rightIndex] ?? 0));
    score += Math.abs((pixels[leftIndex + 1] ?? 0) - (pixels[rightIndex + 1] ?? 0));
    score += Math.abs((pixels[leftIndex + 2] ?? 0) - (pixels[rightIndex + 2] ?? 0));
    score += Math.abs((pixels[leftIndex + 3] ?? 255) - (pixels[rightIndex + 3] ?? 255));
  }

  return score;
}

function normalizeSeamColumn(seamColumn: number, width: number) {
  if (width <= 0) return 0;
  return ((Math.round(seamColumn) % width) + width) % width;
}

function findLowestEnergySeamColumn(pixels: Uint8ClampedArray, width: number, height: number) {
  if (width <= 1) return 0;

  let bestColumn = 1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let seamColumn = 1; seamColumn < width; seamColumn += 1) {
    const score = getColumnTransitionScore(pixels, width, height, seamColumn);
    if (score < bestScore) {
      bestScore = score;
      bestColumn = seamColumn;
    }
  }

  return bestColumn;
}

function relocatePanoramaSeamPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  seamColumn = findLowestEnergySeamColumn(pixels, width, height)
) {
  const normalizedSeam = normalizeSeamColumn(seamColumn, width);

  if (normalizedSeam === 0) {
    return new Uint8ClampedArray(pixels);
  }

  const next = new Uint8ClampedArray(pixels.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = (x + normalizedSeam) % width;
      const sourceIndex = (y * width + sourceX) * 4;
      const targetIndex = (y * width + x) * 4;

      next[targetIndex] = pixels[sourceIndex] ?? 0;
      next[targetIndex + 1] = pixels[sourceIndex + 1] ?? 0;
      next[targetIndex + 2] = pixels[sourceIndex + 2] ?? 0;
      next[targetIndex + 3] = pixels[sourceIndex + 3] ?? 255;
    }
  }

  return next;
}

function optimizeAdaptedPanoramaProjection(context: CanvasRenderingContext2D, width: number, height: number) {
  if (typeof context.getImageData !== "function" || typeof context.putImageData !== "function") {
    return;
  }

  const frame = context.getImageData(0, 0, width, height);
  const seamRelocated = relocatePanoramaSeamPixels(frame.data, width, height);
  const seamSafe = blendPanoramaSeamPixels(seamRelocated, width, height, getSeamBlendWidth(width));
  const poleSafe = softenPanoramaPolePixels(seamSafe, width, height, getPoleBlendHeight(height));
  frame.data.set(poleSafe);
  context.putImageData(frame, 0, 0);
}

function createPanoramaCanvasSize(sourceWidth: number, sourceHeight: number) {
  const desiredWidth = Math.max(sourceWidth, sourceHeight * PANORAMA_RATIO, PANORAMA_MIN_WIDTH);
  const normalizedWidth = roundToEven(clamp(desiredWidth, PANORAMA_MIN_WIDTH, PANORAMA_MAX_WIDTH));

  return {
    width: normalizedWidth,
    height: normalizedWidth / PANORAMA_RATIO,
  };
}

function drawImageContain(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  placement: ContainPlacement
) {
  context.drawImage(source, placement.x, placement.y, placement.width, placement.height);
}

async function readImageSource(file: File): Promise<PanoramaImageSource & CanvasImageSource> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return bitmap;
  }

  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const probeUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(probeUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(probeUrl);
      reject(new Error("无法读取全景图尺寸，请重新选择图片"));
    };

    image.src = probeUrl;
  });
}

async function buildAdaptedPanoramaAsset(file: File) {
  const source = await readImageSource(file);

  try {
    if (isPanoramaRatio(source.width, source.height)) {
      return {
        projectionMode: "equirectangular" as const,
        url: await keepFile(file),
      };
    }

    const { width, height } = createPanoramaCanvasSize(source.width, source.height);
    const placement = getCoverPlacement(source.width, source.height, width, height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("当前环境无法生成全景图，请稍后重试");
    }

    context.fillStyle = "#06080D";
    context.fillRect(0, 0, width, height);

    drawImageContain(context, source, placement);

    optimizeAdaptedPanoramaProjection(context, width, height);

    return {
      projectionMode: "backdrop" as const,
      url: await keepFile(canvas.toDataURL("image/jpeg", 0.92)),
    };
  } finally {
    source.close?.();
  }
}

export async function readPanoramaFile(file: File) {
  if (!PANORAMA_IMAGE_EXTENSION_RE.test(file.name)) {
    throw new Error("当前全景图仅支持 JPG / PNG / WEBP");
  }
  const result = await buildAdaptedPanoramaAsset(file);

  return {
    id: crypto.randomUUID(),
    fileName: file.name,
    name: file.name,
    projectionMode: result.projectionMode,
    url: result.url,
  };
}
