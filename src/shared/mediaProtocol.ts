// src/shared/mediaProtocol.ts
// Shared constant for custom media protocol scheme (SSoT)

export const MEDIA_PROTOCOL = 'sessionmap-media';

/**
 * Build a media protocol URL from an absolute file path.
 * Uses per-segment encodeURIComponent for round-trip compatibility with decodeURIComponent.
 */
export function buildMediaUrl(absolutePath: string): string {
  // Normalize path separators to forward slashes
  const normalized = absolutePath.replace(/\\/g, '/');

  // Ensure leading slash for URL path
  const pathWithLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;

  // Encode each path segment individually for proper round-trip with decodeURIComponent
  const encodedPath = pathWithLeadingSlash
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `${MEDIA_PROTOCOL}://media${encodedPath}`;
}
