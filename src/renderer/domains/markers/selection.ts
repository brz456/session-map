export type MarkerClickModifiers = {
  ctrlOrMeta: boolean;
  shift: boolean;
};

export function computeShiftRangeSelection(
  markers: readonly { markerId: string }[],
  currentSelection: ReadonlySet<string>,
  targetMarkerId: string
): ReadonlySet<string> {
  const targetIndex = markers.findIndex((marker) => marker.markerId === targetMarkerId);
  if (targetIndex === -1) {
    return currentSelection;
  }

  let highestSelectedIndex = -1;
  for (let i = 0; i < markers.length; i += 1) {
    if (currentSelection.has(markers[i].markerId)) {
      highestSelectedIndex = i;
    }
  }

  if (highestSelectedIndex === -1) {
    return new Set([targetMarkerId]);
  }

  const minIndex = Math.min(targetIndex, highestSelectedIndex);
  const maxIndex = Math.max(targetIndex, highestSelectedIndex);
  const rangeIds = markers.slice(minIndex, maxIndex + 1).map((marker) => marker.markerId);

  return new Set([...currentSelection, ...rangeIds]);
}

export function computeClickSelection(opts: {
  markers: readonly { markerId: string }[];
  currentSelection: ReadonlySet<string>;
  targetMarkerId: string;
  modifiers: MarkerClickModifiers;
}): { nextSelection: ReadonlySet<string>; shouldSeek: boolean } {
  const { markers, currentSelection, targetMarkerId, modifiers } = opts;
  const targetIndex = markers.findIndex((marker) => marker.markerId === targetMarkerId);
  if (targetIndex === -1) {
    return { nextSelection: currentSelection, shouldSeek: false };
  }

  if (modifiers.ctrlOrMeta) {
    const next = new Set(currentSelection);
    if (next.has(targetMarkerId)) {
      next.delete(targetMarkerId);
    } else {
      next.add(targetMarkerId);
    }
    return { nextSelection: next, shouldSeek: false };
  }

  if (modifiers.shift) {
    if (currentSelection.size === 0) {
      return { nextSelection: new Set([targetMarkerId]), shouldSeek: true };
    }
    const nextSelection = computeShiftRangeSelection(markers, currentSelection, targetMarkerId);
    return { nextSelection, shouldSeek: false };
  }

  const isDeselecting = currentSelection.has(targetMarkerId) && currentSelection.size === 1;
  if (isDeselecting) {
    return { nextSelection: new Set(), shouldSeek: false };
  }

  return { nextSelection: new Set([targetMarkerId]), shouldSeek: true };
}
