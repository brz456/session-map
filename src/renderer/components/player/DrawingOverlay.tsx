// src/renderer/components/player/DrawingOverlay.tsx
// Canvas overlay for drawing and rendering strokes on top of video

import { useEffect, useRef, useCallback } from 'react';
import type {
  MarkerDrawing,
  DrawingStroke,
  DrawingPoint,
} from '../../../shared/sessionPackage/types';
import { MIN_POINT_DISTANCE, MAX_POINTS_PER_STROKE } from '../../../shared/sessionPackage/types';

export interface DrawingOverlayProps {
  drawing: MarkerDrawing | null;
  enabled: boolean;
  strokeColor: string;
  strokeWidth: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  markerTimeSec: number | null;
  onCommitStroke(stroke: DrawingStroke): void;
  onRequestSnap(): void;
}

// Tolerance for "at marker time" check (0.1 seconds)
const SNAP_TOLERANCE_SEC = 0.1;

export function DrawingOverlay(props: DrawingOverlayProps): JSX.Element {
  const { drawing, enabled, strokeColor, strokeWidth, videoRef, markerTimeSec, onCommitStroke, onRequestSnap } = props;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentStrokeRef = useRef<DrawingPoint[]>([]);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<DrawingPoint | null>(null);

  /**
   * Computes the actual video content rect within the element, accounting for
   * object-fit: contain letterboxing. Returns null if video dimensions are unavailable.
   */
  const getVideoContentRect = useCallback(() => {
    const video = videoRef.current;
    if (!video) return null;

    const elementRect = video.getBoundingClientRect();
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;

    // Video dimensions not yet available
    if (videoWidth === 0 || videoHeight === 0) return null;
    if (elementRect.width === 0 || elementRect.height === 0) return null;

    // Calculate scale for object-fit: contain (fit within element, preserve aspect ratio)
    const scaleX = elementRect.width / videoWidth;
    const scaleY = elementRect.height / videoHeight;
    const scale = Math.min(scaleX, scaleY);

    // Actual content dimensions
    const contentWidth = videoWidth * scale;
    const contentHeight = videoHeight * scale;

    // Center offsets within element
    const offsetX = (elementRect.width - contentWidth) / 2;
    const offsetY = (elementRect.height - contentHeight) / 2;

    return {
      // Content rect in client coordinates
      left: elementRect.left + offsetX,
      top: elementRect.top + offsetY,
      width: contentWidth,
      height: contentHeight,
      // Element rect for canvas sizing
      elementRect,
      // Offsets for rendering (relative to element, not client)
      renderOffsetX: offsetX,
      renderOffsetY: offsetY,
    };
  }, [videoRef]);

  // Convert client coordinates to normalized video coordinates (0..1)
  // Returns null if point is outside video content (in letterbox bars)
  const clientToNormalized = useCallback((clientX: number, clientY: number): DrawingPoint | null => {
    const contentRect = getVideoContentRect();
    if (!contentRect) return null;

    // Calculate position relative to video content (not element)
    const relX = clientX - contentRect.left;
    const relY = clientY - contentRect.top;

    // Reject points outside video content (in letterbox bars)
    if (relX < 0 || relX > contentRect.width || relY < 0 || relY > contentRect.height) {
      return null;
    }

    // Normalize to 0..1
    const x = relX / contentRect.width;
    const y = relY / contentRect.height;

    // Clamp to [0, 1] for safety (floating point edge cases)
    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    };
  }, [getVideoContentRect]);

  // Render all strokes (existing + current) to canvas
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const contentRect = getVideoContentRect();
    if (!contentRect) return;

    // Match canvas size to video element size (covers letterbox bars too)
    // Round to integers: canvas.width/height are integers, DOMRect values are floats
    const { elementRect, renderOffsetX, renderOffsetY, width: contentWidth, height: contentHeight } = contentRect;
    const targetWidth = Math.max(1, Math.round(elementRect.width));
    const targetHeight = Math.max(1, Math.round(elementRect.height));
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Render existing strokes from drawing (within video content area)
    if (drawing) {
      for (const stroke of drawing.strokes) {
        if (stroke.points.length < 2) continue;
        renderStroke(ctx, stroke.points, stroke.color, drawing.strokeWidth, contentWidth, contentHeight, renderOffsetX, renderOffsetY);
      }
    }

    // Render current in-progress stroke
    if (currentStrokeRef.current.length >= 2) {
      renderStroke(ctx, currentStrokeRef.current, strokeColor, strokeWidth, contentWidth, contentHeight, renderOffsetX, renderOffsetY);
    }
  }, [drawing, strokeColor, strokeWidth, getVideoContentRect]);

  // Render a single stroke to context (within video content area, accounting for letterbox offset)
  const renderStroke = (
    ctx: CanvasRenderingContext2D,
    points: DrawingPoint[],
    color: string,
    lineWidth: number,
    contentWidth: number,
    contentHeight: number,
    offsetX: number,
    offsetY: number
  ) => {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const first = points[0];
    ctx.moveTo(offsetX + first.x * contentWidth, offsetY + first.y * contentHeight);

    for (let i = 1; i < points.length; i++) {
      const pt = points[i];
      ctx.lineTo(offsetX + pt.x * contentWidth, offsetY + pt.y * contentHeight);
    }

    ctx.stroke();
  };

  // Re-render when drawing or video size changes
  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // Handle window resize to keep canvas in sync
  useEffect(() => {
    const handleResize = () => renderCanvas();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [renderCanvas]);

  // Check if video is at marker time (within tolerance)
  const isAtMarkerTime = useCallback(() => {
    const video = videoRef.current;
    if (!video || markerTimeSec === null) return false;
    return Math.abs(video.currentTime - markerTimeSec) <= SNAP_TOLERANCE_SEC;
  }, [videoRef, markerTimeSec]);

  // Pointer event handlers
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!enabled) return;

    // If not at marker time, request snap instead of starting to draw
    if (!isAtMarkerTime()) {
      onRequestSnap();
      return;
    }

    // Validate point is within video content (not in letterbox bars) before capturing
    const point = clientToNormalized(e.clientX, e.clientY);
    if (!point) return;

    e.preventDefault();
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.setPointerCapture(e.pointerId);
    }

    isDrawingRef.current = true;
    currentStrokeRef.current = [point];
    lastPointRef.current = point;
    renderCanvas();
  }, [enabled, isAtMarkerTime, onRequestSnap, clientToNormalized, renderCanvas]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!enabled || !isDrawingRef.current) return;

    const point = clientToNormalized(e.clientX, e.clientY);
    if (!point) return;

    // Enforce minimum distance between points (decimation)
    const lastPoint = lastPointRef.current;
    if (lastPoint) {
      const dx = point.x - lastPoint.x;
      const dy = point.y - lastPoint.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < MIN_POINT_DISTANCE) {
        return; // Skip point, too close to previous
      }
    }

    // Enforce max points per stroke
    if (currentStrokeRef.current.length >= MAX_POINTS_PER_STROKE) {
      return; // Stop adding points
    }

    currentStrokeRef.current.push(point);
    lastPointRef.current = point;
    renderCanvas();
  }, [enabled, clientToNormalized, renderCanvas]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!enabled || !isDrawingRef.current) return;

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.releasePointerCapture(e.pointerId);
    }

    isDrawingRef.current = false;

    // Only commit if we have at least 2 points
    if (currentStrokeRef.current.length >= 2) {
      const stroke: DrawingStroke = {
        color: strokeColor,
        points: [...currentStrokeRef.current],
      };
      onCommitStroke(stroke);
    }

    currentStrokeRef.current = [];
    lastPointRef.current = null;
    renderCanvas();
  }, [enabled, strokeColor, onCommitStroke, renderCanvas]);

  const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!enabled) return;

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.releasePointerCapture(e.pointerId);
    }

    // Discard in-progress stroke on cancel
    isDrawingRef.current = false;
    currentStrokeRef.current = [];
    lastPointRef.current = null;
    renderCanvas();
  }, [enabled, renderCanvas]);

  return (
    <canvas
      ref={canvasRef}
      className={`drawing-overlay ${enabled ? 'drawing-overlay--enabled' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    />
  );
}
