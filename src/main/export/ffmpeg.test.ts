import { describe, expect, it } from 'vitest';
import { resolveFfmpegStaticExport } from './ffmpeg';

describe('resolveFfmpegStaticExport', () => {
  it('rewrites app.asar path to app.asar.unpacked before path existence check', () => {
    const asarPath = 'C:\\Program Files\\SessionMap\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe';
    const unpackedPath = 'C:\\Program Files\\SessionMap\\resources\\app.asar.unpacked\\node_modules\\ffmpeg-static\\ffmpeg.exe';
    const checkedPaths: string[] = [];

    const result = resolveFfmpegStaticExport(asarPath, (candidatePath) => {
      checkedPaths.push(candidatePath);
      return candidatePath === unpackedPath;
    });

    expect(result).toEqual({ ok: true, path: unpackedPath });
    expect(checkedPaths).toEqual([unpackedPath]);
  });

  it('fails closed with explicit error when app.asar.unpacked binary is missing', () => {
    const asarPath = 'C:\\Program Files\\SessionMap\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe';
    const unpackedPath = 'C:\\Program Files\\SessionMap\\resources\\app.asar.unpacked\\node_modules\\ffmpeg-static\\ffmpeg.exe';

    const result = resolveFfmpegStaticExport(asarPath, () => false);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.message).toContain('resolved inside app.asar');
    expect(result.message).toContain(unpackedPath);
    expect(result.message).toContain(asarPath);
  });

  it('fails closed when ffmpeg-static export is non-string', () => {
    const result = resolveFfmpegStaticExport({ bad: 'shape' });

    expect(result).toEqual({
      ok: false,
      message: 'ffmpeg-static returned non-string value: [object Object]',
    });
  });

  it('passes through non-asar string paths unchanged', () => {
    const plainPath = 'C:\\workspace\\session-map\\node_modules\\ffmpeg-static\\ffmpeg.exe';
    const checkedPaths: string[] = [];

    const result = resolveFfmpegStaticExport(plainPath, (candidatePath) => {
      checkedPaths.push(candidatePath);
      return candidatePath === plainPath;
    });

    expect(result).toEqual({ ok: true, path: plainPath });
    expect(checkedPaths).toEqual([plainPath]);
  });
});
