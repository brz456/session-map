// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { toKeyChord } from './chords';

describe('toKeyChord', () => {
  it('normalizes space to Space', () => {
    const event = new KeyboardEvent('keydown', { key: ' ' });
    expect(toKeyChord(event)).toBe('Space');
  });

  it('uses physical Comma/Period for Shift+Comma/Period', () => {
    const commaEvent = new KeyboardEvent('keydown', { key: '<', code: 'Comma', shiftKey: true });
    const periodEvent = new KeyboardEvent('keydown', { key: '>', code: 'Period', shiftKey: true });

    expect(toKeyChord(commaEvent)).toBe('Shift+Comma');
    expect(toKeyChord(periodEvent)).toBe('Shift+Period');
  });

  it('uppercases base keys deterministically', () => {
    const lowerEvent = new KeyboardEvent('keydown', { key: 'k' });
    const upperEvent = new KeyboardEvent('keydown', { key: 'K', shiftKey: true });

    expect(toKeyChord(lowerEvent)).toBe('K');
    expect(toKeyChord(upperEvent)).toBe('Shift+K');
  });

  it('orders modifiers deterministically', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      metaKey: true,
      altKey: true,
      shiftKey: true,
    });
    expect(toKeyChord(event)).toBe('Ctrl+Meta+Alt+Shift+K');
  });
});
