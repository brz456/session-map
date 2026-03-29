import { describe, expect, it } from 'vitest';
import { toAsarUnpackedPath } from './asarPath';

describe('toAsarUnpackedPath', () => {
  it('rewrites Windows app.asar segment to app.asar.unpacked', () => {
    const input = 'C:\\Program Files\\SessionMap\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe';
    const expected = 'C:\\Program Files\\SessionMap\\resources\\app.asar.unpacked\\node_modules\\ffmpeg-static\\ffmpeg.exe';
    expect(toAsarUnpackedPath(input)).toBe(expected);
  });

  it('rewrites POSIX app.asar segment to app.asar.unpacked', () => {
    const input = '/opt/SessionMap/resources/app.asar/node_modules/ffmpeg-static/ffmpeg';
    const expected = '/opt/SessionMap/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg';
    expect(toAsarUnpackedPath(input)).toBe(expected);
  });

  it('is idempotent for already-unpacked paths', () => {
    const input = 'C:\\Program Files\\SessionMap\\resources\\app.asar.unpacked\\node_modules\\obs-studio-node';
    expect(toAsarUnpackedPath(input)).toBe(input);
  });

  it('leaves non-asar paths unchanged', () => {
    const input = 'C:\\workspace\\session-map\\node_modules\\ffmpeg-static\\ffmpeg.exe';
    expect(toAsarUnpackedPath(input)).toBe(input);
  });

  it('does not rewrite when app.asar is only a substring inside a segment', () => {
    const input = 'C:\\workspace\\builds\\myapp.asar.backup\\ffmpeg.exe';
    expect(toAsarUnpackedPath(input)).toBe(input);
  });

  it('does not rewrite when app.asar appears in a filename, not a path segment', () => {
    const input = '/tmp/recordings/app.asar.mp4';
    expect(toAsarUnpackedPath(input)).toBe(input);
  });
});
