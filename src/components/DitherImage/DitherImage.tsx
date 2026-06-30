"use client";

import { useEffect, useRef, type CSSProperties } from "react";

// 4x4 ordered (Bayer) threshold matrix, values 0..15
const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

type DitherImageProps = {
  src: string;
  /** width of the low-res dither buffer in px; lower = chunkier dots */
  resolution?: number;
  /** quantization steps per channel; lower = more banding */
  levels?: number;
  alt?: string;
  className?: string;
  style?: CSSProperties;
};

/**
 * Draws an image into a low-res canvas, applies ordered (Bayer) dithering per
 * channel, then lets CSS upscale it with nearest-neighbour for a crisp retro
 * dither. The image is cover-cropped to whatever box the canvas is sized to.
 */
export function DitherImage({
  src,
  resolution = 140,
  levels = 4,
  alt = "",
  className = "",
  style,
}: DitherImageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;

    const render = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height || !img.naturalWidth) return;

      const boxAspect = rect.width / rect.height;
      const w = Math.max(1, Math.round(resolution));
      const h = Math.max(1, Math.round(resolution / boxAspect));
      canvas.width = w;
      canvas.height = h;

      // cover-crop the source into the buffer
      const imgAspect = img.naturalWidth / img.naturalHeight;
      let sw: number, sh: number, sx: number, sy: number;
      if (imgAspect > boxAspect) {
        sh = img.naturalHeight;
        sw = sh * boxAspect;
        sx = (img.naturalWidth - sw) / 2;
        sy = 0;
      } else {
        sw = img.naturalWidth;
        sh = sw / boxAspect;
        sx = 0;
        sy = (img.naturalHeight - sh) / 2;
      }

      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);

      const image = ctx.getImageData(0, 0, w, h);
      const d = image.data;
      const step = 255 / (levels - 1);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const threshold = ((BAYER_4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5) * step;
          for (let c = 0; c < 3; c++) {
            const v = d[i + c] + threshold;
            d[i + c] = Math.max(0, Math.min(255, Math.round(v / step) * step));
          }
        }
      }
      ctx.putImageData(image, 0, 0);
    };

    if (img.complete && img.naturalWidth) render();
    else img.onload = render;

    const ro = new ResizeObserver(render);
    ro.observe(canvas);

    return () => {
      ro.disconnect();
      img.onload = null;
    };
  }, [src, resolution, levels]);

  return (
    <canvas
      ref={canvasRef}
      aria-label={alt}
      className={className}
      style={{ imageRendering: "pixelated", display: "block", ...style }}
    />
  );
}
