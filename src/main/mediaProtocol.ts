// src/main/mediaProtocol.ts
// Custom protocol for secure local media file access
// Allows renderer to load local media files without disabling webSecurity

import { protocol } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { MEDIA_PROTOCOL } from '../shared/mediaProtocol';
import { getMediaMimeType, isSupportedMediaExtension } from '../shared/mediaExtensions';

// Allowlist of exact file paths that can be served
// Only populated when media files are successfully added to the session (SSoT)
const allowedMediaFiles = new Set<string>();

/**
 * Add an exact file path to the media protocol allowlist.
 * Called when a media asset is successfully added to the session.
 */
export function addAllowedMediaFile(absolutePath: string): void {
  allowedMediaFiles.add(path.resolve(absolutePath).toLowerCase());
}

/**
 * Remove a file path from the allowlist.
 * Called when a media asset is removed from the session.
 */
export function removeAllowedMediaFile(absolutePath: string): void {
  allowedMediaFiles.delete(path.resolve(absolutePath).toLowerCase());
}

/**
 * Clear all allowed media files.
 * Called when session is closed.
 */
export function clearAllowedMediaFiles(): void {
  allowedMediaFiles.clear();
}

function isPathAllowed(filePath: string): boolean {
  const resolved = path.resolve(filePath).toLowerCase();
  return allowedMediaFiles.has(resolved);
}

/**
 * Parse and validate Range header.
 * Returns null for no range, parsed range for valid, or 'invalid' for malformed/unsatisfiable.
 */
function parseRangeHeader(
  rangeHeader: string | null,
  fileSize: number
): { start: number; end: number } | null | 'invalid' {
  if (rangeHeader === null) {
    return null;
  }

  // Only support bytes ranges
  const match = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
  if (!match) {
    return 'invalid';
  }

  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

  // Validate range is satisfiable
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    start >= fileSize ||
    end < start ||
    end >= fileSize
  ) {
    return 'invalid';
  }

  return { start, end };
}

/**
 * Register the custom media protocol.
 * Must be called in app.whenReady() before creating windows.
 */
export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_PROTOCOL, async (request) => {
    // Only allow GET and HEAD methods
    const method = request.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { allow: 'GET, HEAD' },
      });
    }

    // Parse URL with error handling
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('Malformed URL', { status: 400 });
    }

    // Decode the pathname with error handling
    // URL format: sessionmap-media://host/C:/path/to/file.mp4
    let filePath: string;
    try {
      filePath = decodeURIComponent(url.pathname);
    } catch {
      return new Response('Invalid URL encoding', { status: 400 });
    }

    // Remove leading slash for Windows absolute paths (e.g., /C:/... -> C:/...)
    if (filePath.match(/^\/[A-Za-z]:/)) {
      filePath = filePath.slice(1);
    }

    // Security: validate exact file path is allowlisted
    if (!isPathAllowed(filePath)) {
      return new Response('Forbidden: path not in allowlist', { status: 403 });
    }

    // Security: validate file exists and is a regular file
    let fileSize: number;
    try {
      const stats = await fs.promises.stat(filePath);
      if (!stats.isFile()) {
        return new Response('Not a file', { status: 400 });
      }
      fileSize = stats.size;
    } catch {
      return new Response('File not found', { status: 404 });
    }

    // Validate extension (shared policy)
    const ext = path.extname(filePath).toLowerCase();
    if (!isSupportedMediaExtension(ext)) {
      return new Response('Unsupported file type', { status: 415 });
    }
    const contentType = getMediaMimeType(ext);

    // Parse and validate Range header
    const rangeHeader = request.headers.get('range');
    const range = parseRangeHeader(rangeHeader, fileSize);

    if (range === 'invalid') {
      return new Response('Range Not Satisfiable', {
        status: 416,
        headers: { 'content-range': `bytes */${fileSize}` },
      });
    }

    // Determine byte range to serve
    const start = range?.start ?? 0;
    const end = range?.end ?? fileSize - 1;
    const contentLength = end - start + 1;

    // Build response headers (shared between GET and HEAD)
    const isRangeRequest = range !== null;
    const responseHeaders: Record<string, string> = {
      'content-type': contentType,
      'content-length': String(contentLength),
      'accept-ranges': 'bytes',
    };
    if (isRangeRequest) {
      responseHeaders['content-range'] = `bytes ${start}-${end}/${fileSize}`;
    }

    // HEAD: return headers only, no body
    if (method === 'HEAD') {
      return new Response(null, {
        status: isRangeRequest ? 206 : 200,
        statusText: isRangeRequest ? 'Partial Content' : 'OK',
        headers: responseHeaders,
      });
    }

    // GET: stream the file (no memory buffering)
    const readStream = fs.createReadStream(filePath, { start, end });
    const webStream = Readable.toWeb(readStream) as ReadableStream<Uint8Array>;

    return new Response(webStream, {
      status: isRangeRequest ? 206 : 200,
      statusText: isRangeRequest ? 'Partial Content' : 'OK',
      headers: responseHeaders,
    });
  });
}
