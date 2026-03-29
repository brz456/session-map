import { useCallback, useState } from 'react';
import type { ModalKind } from '../../input/modes';
import type { InputDomain } from '../input/inputDomain';

export type ModalPayload =
  | {
      type: 'bucket' | 'tag';
      id: string;
      name: string;
      referenceCount: number;
    }
  | {
      type: 'clip';
      id: string;
      name: string;
      markerCount: number;
      eventCount: number;
    }
  | {
      markerIds: string[];
      note?: string;
    }
  | null;

export interface ModalDomainState {
  payload: ModalPayload;
}

export interface ModalDomainActions {
  open(kind: ModalKind, payload?: ModalPayload): void;
  close(): void;
  setPayload(payload: ModalPayload): void;
  clearPayload(): void;
}

export function useModalDomain(deps: { input: InputDomain }): {
  state: ModalDomainState;
  actions: ModalDomainActions;
} {
  const [payload, setPayloadState] = useState<ModalPayload>(null);

  const open = useCallback(
    (kind: ModalKind, nextPayload: ModalPayload = null) => {
      const patch: Parameters<typeof deps.input.actions.set>[0] = { modalKind: kind };
      if (kind === 'closeConfirm') {
        patch.closeConfirmChoice = 'save';
      } else if (
        kind === 'bucketDeleteConfirm' ||
        kind === 'tagDeleteConfirm' ||
        kind === 'markerDeleteConfirm' ||
        kind === 'clipDeleteConfirm'
      ) {
        patch.deleteConfirmChoice = 'cancel';
      } else if (kind === 'newSession') {
        patch.newSessionFocus = 'input';
      }
      deps.input.actions.set(patch);
      setPayloadState(nextPayload ?? null);
    },
    [deps.input.actions]
  );

  const close = useCallback(() => {
    setPayloadState(null);
    deps.input.actions.set({
      modalKind: 'none',
      closeConfirmChoice: 'cancel',
      deleteConfirmChoice: 'cancel',
      newSessionFocus: 'input',
    });
  }, [deps.input.actions]);

  const setPayload = useCallback((nextPayload: ModalPayload) => {
    setPayloadState(nextPayload);
  }, []);

  const clearPayload = useCallback(() => {
    setPayloadState(null);
  }, []);

  return {
    state: { payload },
    actions: {
      open,
      close,
      setPayload,
      clearPayload,
    },
  };
}
