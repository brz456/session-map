import type { InputState } from '../modes';
import { isTextInputLike } from '../../utils/dom';

export function shouldExitToPlayerOnClickCapture(
  state: InputState,
  target: EventTarget | null
): boolean {
  if (state.workspace !== 'session') return false;
  if (state.modalKind !== 'none') return false;
  if (state.sessionMode === 'player') return false;

  const element = target instanceof Element ? target : null;

  if (isTextInputLike(element)) return false;
  if (state.sessionMode === 'drawing' && element?.closest('.drawing-overlay')) {
    return false;
  }

  return true;
}
