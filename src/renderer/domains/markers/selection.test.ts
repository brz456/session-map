import { describe, it, expect } from 'vitest';
import { computeClickSelection, computeShiftRangeSelection } from './selection';

const markers = [
  { markerId: 'a' },
  { markerId: 'b' },
  { markerId: 'c' },
  { markerId: 'd' },
];

describe('marker selection', () => {
  it('ctrl/meta toggles membership without seeking', () => {
    const addResult = computeClickSelection({
      markers,
      currentSelection: new Set(),
      targetMarkerId: 'b',
      modifiers: { ctrlOrMeta: true, shift: false },
    });
    expect([...addResult.nextSelection]).toEqual(['b']);
    expect(addResult.shouldSeek).toBe(false);

    const removeResult = computeClickSelection({
      markers,
      currentSelection: new Set(['b']),
      targetMarkerId: 'b',
      modifiers: { ctrlOrMeta: true, shift: false },
    });
    expect([...removeResult.nextSelection]).toEqual([]);
    expect(removeResult.shouldSeek).toBe(false);
  });

  it('shift range selection uses highest-index anchor and does not seek', () => {
    const currentSelection = new Set(['b', 'd']);
    const nextSelection = computeShiftRangeSelection(markers, currentSelection, 'b');
    expect([...nextSelection].sort()).toEqual(['b', 'c', 'd']);

    const result = computeClickSelection({
      markers,
      currentSelection,
      targetMarkerId: 'b',
      modifiers: { ctrlOrMeta: false, shift: true },
    });
    expect([...result.nextSelection].sort()).toEqual(['b', 'c', 'd']);
    expect(result.shouldSeek).toBe(false);
  });

  it('shift click with empty selection selects and seeks', () => {
    const result = computeClickSelection({
      markers,
      currentSelection: new Set(),
      targetMarkerId: 'c',
      modifiers: { ctrlOrMeta: false, shift: true },
    });
    expect([...result.nextSelection]).toEqual(['c']);
    expect(result.shouldSeek).toBe(true);
  });

  it('plain click selects only target and seeks', () => {
    const result = computeClickSelection({
      markers,
      currentSelection: new Set(['a', 'b']),
      targetMarkerId: 'c',
      modifiers: { ctrlOrMeta: false, shift: false },
    });
    expect([...result.nextSelection]).toEqual(['c']);
    expect(result.shouldSeek).toBe(true);
  });

  it('clicking only-selected marker deselects without seeking', () => {
    const result = computeClickSelection({
      markers,
      currentSelection: new Set(['b']),
      targetMarkerId: 'b',
      modifiers: { ctrlOrMeta: false, shift: false },
    });
    expect([...result.nextSelection]).toEqual([]);
    expect(result.shouldSeek).toBe(false);
  });
});
