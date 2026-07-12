import { isImageFile, canvasToBlob, blobToDataUrl } from "./index.js";

const AVATAR_MAX_SOURCE_BYTES = 60 * 1024 * 1024;
const AVATAR_TARGET_BYTES = 360 * 1024;
const AVATAR_HARD_LIMIT_BYTES = 720 * 1024;
const AVATAR_MAX_DIMENSION = 512;

export async function loadImageSource(file) {
  if (window.createImageBitmap) {
    try {
      const bitmap = await window.createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close?.(),
      };
    } catch {
      try {
        const bitmap = await window.createImageBitmap(file);
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          close: () => bitmap.close?.(),
        };
      } catch {
        // Fall back to an HTMLImageElement below.
      }
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("图片无法读取"));
      img.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export async function compressAvatarImage(file) {
  if (!isImageFile(file)) throw new Error("请选择图片文件");
  if (file.size > AVATAR_MAX_SOURCE_BYTES) throw new Error("图片太大，请重新上传。");

  const image = await loadImageSource(file);
  try {
    const width = Number(image.width || 0);
    const height = Number(image.height || 0);
    if (!width || !height) throw new Error("图片无法读取，请重新上传。");

    const cropSize = Math.min(width, height);
    const sourceX = Math.max(0, Math.floor((width - cropSize) / 2));
    const sourceY = Math.max(0, Math.floor((height - cropSize) / 2));
    const outputSizes = [...new Set([Math.min(AVATAR_MAX_DIMENSION, cropSize), 384, 320, 256].filter((size) => size > 0 && size <= cropSize))];
    const qualities = [0.88, 0.8, 0.72, 0.64, 0.56, 0.48, 0.4];
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("当前浏览器无法压缩图片，请重新上传更小的图片。");

    let bestBlob = null;
    for (const size of outputSizes) {
      canvas.width = size;
      canvas.height = size;
      context.clearRect(0, 0, size, size);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size, size);
      context.drawImage(image.source, sourceX, sourceY, cropSize, cropSize, 0, 0, size, size);

      for (const quality of qualities) {
        const blob = await canvasToBlob(canvas, "image/jpeg", quality);
        if (!blob) continue;
        if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
        if (blob.size <= AVATAR_TARGET_BYTES) return blobToDataUrl(blob);
      }
    }

    if (bestBlob && bestBlob.size <= AVATAR_HARD_LIMIT_BYTES) return blobToDataUrl(bestBlob);
    throw new Error("图片太大，请重新上传。");
  } finally {
    image.close?.();
  }
}