/** Best-effort blur; never throws. */
export function blurActiveElement(): void {
  try {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  } catch {
    // Best-effort only
  }
}

export function isTextInputLike(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLInputElement) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return false;
}
