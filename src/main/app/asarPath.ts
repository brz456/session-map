// src/main/app/asarPath.ts

/**
 * In packaged Electron apps, native executables must be loaded from
 * app.asar.unpacked, not app.asar.
 * This transform is idempotent and leaves non-asar paths unchanged.
 */
export function toAsarUnpackedPath(pathToFix: string): string {
  if (/(^|[\\/])app\.asar\.unpacked(?=([\\/]|$))/.test(pathToFix)) {
    return pathToFix;
  }
  return pathToFix.replace(
    /(^|[\\/])app\.asar(?=([\\/]|$))/,
    '$1app.asar.unpacked',
  );
}
