export type KeyChord = string;

export function toKeyChord(e: KeyboardEvent): KeyChord | null {
  if (e.key === 'Tab') {
    return 'Tab';
  }

  if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') {
    return null;
  }

  let baseKey = e.key;
  if (!baseKey || baseKey === 'Unidentified') {
    return null;
  }

  if (baseKey === ' ') {
    baseKey = 'Space';
  }

  if (e.code === 'Comma') {
    baseKey = 'Comma';
  } else if (e.code === 'Period') {
    baseKey = 'Period';
  }

  if (baseKey.length === 1) {
    baseKey = baseKey.toUpperCase();
  }

  const modifiers: string[] = [];
  if (e.ctrlKey) modifiers.push('Ctrl');
  if (e.metaKey) modifiers.push('Meta');
  if (e.altKey) modifiers.push('Alt');
  if (e.shiftKey) modifiers.push('Shift');

  if (modifiers.length === 0) {
    return baseKey;
  }

  return `${modifiers.join('+')}+${baseKey}`;
}
