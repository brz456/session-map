import { useCallback, useReducer } from 'react';
import { blurActiveElement } from '../../utils/dom';
import type { InputState } from '../../input/modes';

export interface InputDomainState extends InputState {}

export interface InputDomainActions {
  set(patch: Partial<InputState>): void;
  /**
   * SSoT: Exit any session submode back to `sessionMode: 'player'` with deterministic cleanup.
   * Parity target: `src/renderer/components/App.tsx:684`.
   */
  resetToPlayerMode(): void;
}

export interface InputDomain {
  state: InputDomainState;
  actions: InputDomainActions;
}

type InputDomainAction =
  | { type: 'set'; patch: Partial<InputState> }
  | { type: 'resetToPlayerMode' };

function reducer(state: InputState, action: InputDomainAction): InputState {
  switch (action.type) {
    case 'set':
      return { ...state, ...action.patch };
    case 'resetToPlayerMode':
      return {
        ...state,
        sessionMode: 'player',
        highlightedBucketId: null,
        highlightedTagId: null,
        highlightedMarkerId: null,
        markerListAnchorId: null,
        highlightedClipIndex: -1,
        bucketDraftTitle: '',
        tagDraftName: '',
      };
    default: {
      const _exhaustive: never = action;
      throw new Error(`Unhandled input domain action: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export function useInputDomain(initial: InputState): InputDomain {
  const [state, dispatch] = useReducer(reducer, initial);

  const set = useCallback((patch: Partial<InputState>) => {
    dispatch({ type: 'set', patch });
  }, []);

  const resetToPlayerMode = useCallback(() => {
    blurActiveElement();
    dispatch({ type: 'resetToPlayerMode' });
  }, []);

  return {
    state,
    actions: {
      set,
      resetToPlayerMode,
    },
  };
}
