export type TagNavDirection = 'up' | 'down' | 'left' | 'right';

const DIRECTIONAL_DEADBAND_PX = 5;
const SECONDARY_AXIS_WEIGHT = 0.5;

type TagPosition = { tagId: string; rect: DOMRect };

export function findTagInDirection(currentTagId: string | null, direction: TagNavDirection): string | null {
  const tagButtons = document.querySelectorAll<HTMLElement>('[data-tag-id]');
  if (tagButtons.length === 0) return null;

  const tagPositions: TagPosition[] = [];
  tagButtons.forEach((btn) => {
    const tagId = btn.dataset.tagId;
    if (tagId) {
      tagPositions.push({ tagId, rect: btn.getBoundingClientRect() });
    }
  });

  if (tagPositions.length === 0) return null;

  const sortedByVisualOrder = [...tagPositions].sort((a, b) => {
    if (a.rect.top !== b.rect.top) return a.rect.top - b.rect.top;
    if (a.rect.left !== b.rect.left) return a.rect.left - b.rect.left;
    return a.tagId < b.tagId ? -1 : a.tagId > b.tagId ? 1 : 0;
  });

  if (!currentTagId) {
    return sortedByVisualOrder[0]?.tagId ?? null;
  }

  const currentPos = tagPositions.find((position) => position.tagId === currentTagId);
  if (!currentPos) {
    return null;
  }

  const currentCenterX = currentPos.rect.left + currentPos.rect.width / 2;
  const currentCenterY = currentPos.rect.top + currentPos.rect.height / 2;

  let bestCandidate: { tagId: string; distance: number } | null = null;

  for (const candidate of tagPositions) {
    if (candidate.tagId === currentTagId) continue;

    const candCenterX = candidate.rect.left + candidate.rect.width / 2;
    const candCenterY = candidate.rect.top + candidate.rect.height / 2;

    let isInDirection = false;
    if (direction === 'up' && candCenterY < currentCenterY - DIRECTIONAL_DEADBAND_PX) {
      isInDirection = true;
    } else if (direction === 'down' && candCenterY > currentCenterY + DIRECTIONAL_DEADBAND_PX) {
      isInDirection = true;
    } else if (direction === 'left' && candCenterX < currentCenterX - DIRECTIONAL_DEADBAND_PX) {
      isInDirection = true;
    } else if (direction === 'right' && candCenterX > currentCenterX + DIRECTIONAL_DEADBAND_PX) {
      isInDirection = true;
    }

    if (!isInDirection) continue;

    const dx = Math.abs(candCenterX - currentCenterX);
    const dy = Math.abs(candCenterY - currentCenterY);

    let distance: number;
    if (direction === 'up' || direction === 'down') {
      distance = dy + dx * SECONDARY_AXIS_WEIGHT;
    } else {
      distance = dx + dy * SECONDARY_AXIS_WEIGHT;
    }

    if (!bestCandidate || distance < bestCandidate.distance) {
      bestCandidate = { tagId: candidate.tagId, distance };
      continue;
    }

    if (distance === bestCandidate.distance) {
      const bestIndex = sortedByVisualOrder.findIndex((entry) => entry.tagId === bestCandidate?.tagId);
      const candidateIndex = sortedByVisualOrder.findIndex((entry) => entry.tagId === candidate.tagId);
      if (candidateIndex !== -1 && (bestIndex === -1 || candidateIndex < bestIndex)) {
        bestCandidate = { tagId: candidate.tagId, distance };
      }
    }
  }

  return bestCandidate?.tagId ?? null;
}
