// src/renderer/drawing/render.ts
// Pure rendering helpers for drawing strokes - used by overlay and export

import type { MarkerDrawing } from '../../shared/sessionPackage/types';
import { DRAWING_COORDINATE_SPACE } from '../../shared/sessionPackage/types';

/**
 * Renders a MarkerDrawing to an offscreen canvas at the specified dimensions.
 * Strokes are scaled from normalized (0..1) coordinates to pixel coordinates.
 *
 * Preconditions (fail-closed):
 * - drawing.coordinateSpace must be DRAWING_COORDINATE_SPACE
 * - width/height must be positive integers
 * - drawing.strokeWidth must be finite and > 0
 * - All strokes must have at least 2 points
 */
export function renderDrawingToCanvas(
  drawing: MarkerDrawing,
  width: number,
  height: number
): HTMLCanvasElement {
  // Fail-closed precondition checks
  if (drawing.coordinateSpace !== DRAWING_COORDINATE_SPACE) {
    throw new Error(`Invalid coordinateSpace: expected '${DRAWING_COORDINATE_SPACE}', got '${drawing.coordinateSpace}'`);
  }
  if (!Number.isFinite(width) || !Number.isInteger(width) || width <= 0) {
    throw new Error(`Invalid width: ${width} (must be positive integer)`);
  }
  if (!Number.isFinite(height) || !Number.isInteger(height) || height <= 0) {
    throw new Error(`Invalid height: ${height} (must be positive integer)`);
  }
  if (!Number.isFinite(drawing.strokeWidth) || drawing.strokeWidth <= 0) {
    throw new Error(`Invalid strokeWidth: ${drawing.strokeWidth} (must be finite and > 0)`);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2D context');
  }

  // Clear canvas (transparent)
  ctx.clearRect(0, 0, width, height);

  // Render each stroke
  for (let i = 0; i < drawing.strokes.length; i++) {
    const stroke = drawing.strokes[i];
    if (stroke.points.length < 2) {
      throw new Error(`Invalid stroke at index ${i}: must have at least 2 points, got ${stroke.points.length}`);
    }

    ctx.beginPath();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = drawing.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const firstPoint = stroke.points[0];
    ctx.moveTo(firstPoint.x * width, firstPoint.y * height);

    for (let i = 1; i < stroke.points.length; i++) {
      const point = stroke.points[i];
      ctx.lineTo(point.x * width, point.y * height);
    }

    ctx.stroke();
  }

  return canvas;
}

/**
 * Converts a canvas to a base64-encoded PNG payload.
 * Returns just the base64 string (without the data URL prefix).
 */
export async function canvasToPngBase64(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to create blob from canvas'));
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          // Extract just the base64 portion (after "data:image/png;base64,")
          const parts = reader.result.split(',');
          const base64 = parts[1];
          if (!base64) {
            reject(new Error('Invalid data URL format: missing base64 payload'));
            return;
          }
          resolve(base64);
        } else {
          reject(new Error('FileReader result is not a string'));
        }
      };
      reader.onerror = () => reject(new Error('FileReader error'));
      reader.readAsDataURL(blob);
    }, 'image/png');
  });
}
