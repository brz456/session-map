export const SUPPORTED_MEDIA_EXTENSIONS = ['.mp4'] as const;
export type SupportedMediaExtension = (typeof SUPPORTED_MEDIA_EXTENSIONS)[number];

const MEDIA_EXTENSION_MIME: Record<SupportedMediaExtension, string> = {
  '.mp4': 'video/mp4',
};

/** ext must be lowercase and include leading dot (e.g. ".mp4"). */
export function isSupportedMediaExtension(ext: string): ext is SupportedMediaExtension {
  return SUPPORTED_MEDIA_EXTENSIONS.includes(ext as SupportedMediaExtension);
}

export function getMediaMimeType(ext: SupportedMediaExtension): string {
  return MEDIA_EXTENSION_MIME[ext];
}

/** Case-insensitive check against SUPPORTED_MEDIA_EXTENSIONS using endsWith(). */
export function hasSupportedMediaExtension(pathOrFilename: string): boolean {
  const normalized = pathOrFilename.toLowerCase();
  return SUPPORTED_MEDIA_EXTENSIONS.some((ext) => normalized.endsWith(ext));
}
