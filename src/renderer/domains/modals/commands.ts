import type { PartialCommandRegistry } from '../../input/commands/registry';
import type { InputDomain } from '../input/inputDomain';
import type { ModalDomainState, ModalDomainActions } from './modalDomain';
import type { SessionDomainActions } from '../session/sessionDomain';
import type { BucketDomainActions } from '../buckets/bucketDomain';
import type { TagDomainActions } from '../tags/tagDomain';
import type { MarkerDomainActions } from '../markers/markerDomain';
import type { UseSessionPersistenceResult } from '../../session/useSessionPersistence';
import type { HomeDomainState } from '../home/homeDomain';

export function createModalCommands(deps: {
  input: InputDomain;
  modals: { state: ModalDomainState; actions: ModalDomainActions };
  session: { actions: SessionDomainActions };
  buckets: { actions: BucketDomainActions };
  tags: { actions: TagDomainActions };
  markers: {
    actions: Pick<MarkerDomainActions, 'deleteMarker' | 'deselectAll'>;
  };
  home: {
    state: Pick<HomeDomainState, 'newSessionName'>;
  };
  persistence: UseSessionPersistenceResult;
}): PartialCommandRegistry {
  const runCloseConfirm = async (choice: 'save' | 'discard' | 'cancel') => {
    deps.input.actions.set({ closeConfirmChoice: choice });
    if (choice === 'cancel') {
      deps.modals.actions.close();
      return;
    }

    deps.modals.actions.close();

    if (choice === 'save') {
      const saveResult = await deps.persistence.flushSave();
      if (!saveResult.ok) {
        throw new Error(`Save failed: ${saveResult.message}. Close aborted.`);
      }
      await deps.session.actions.closeSession();
      return;
    }

    deps.persistence.cancelPendingSaves();
    await deps.session.actions.closeSession();
  };

  const runDeleteConfirm = async (choice: 'confirm' | 'cancel') => {
    deps.input.actions.set({ deleteConfirmChoice: choice });
    if (choice !== 'confirm') {
      deps.modals.actions.close();
      return;
    }

    const kind = deps.input.state.modalKind;
    const payload = deps.modals.state.payload;

    if (kind === 'bucketDeleteConfirm') {
      if (!payload || !('type' in payload) || payload.type !== 'bucket') {
        throw new Error('Bucket delete confirm missing payload');
      }
      await deps.buckets.actions.forceRemoveBucket(payload.id);
      deps.input.actions.set({ highlightedBucketId: null });
      deps.modals.actions.close();
      return;
    }

    if (kind === 'tagDeleteConfirm') {
      if (!payload || !('type' in payload) || payload.type !== 'tag') {
        throw new Error('Tag delete confirm missing payload');
      }
      await deps.tags.actions.forceRemoveTag(payload.id);
      deps.input.actions.set({ highlightedTagId: null });
      deps.modals.actions.close();
      return;
    }

    if (kind === 'clipDeleteConfirm') {
      if (!payload || !('type' in payload) || payload.type !== 'clip') {
        throw new Error('Clip delete confirm missing payload');
      }
      await deps.session.actions.removeMediaFromSession(payload.id);
      deps.modals.actions.close();
      return;
    }

    if (kind === 'markerDeleteConfirm') {
      if (!payload || !('markerIds' in payload)) {
        throw new Error('Marker delete confirm missing payload');
      }
      if (
        deps.input.state.highlightedMarkerId &&
        payload.markerIds.includes(deps.input.state.highlightedMarkerId)
      ) {
        deps.input.actions.set({ highlightedMarkerId: null });
      }
      for (const markerId of payload.markerIds) {
        await deps.markers.actions.deleteMarker(markerId);
      }
      deps.markers.actions.deselectAll();
      deps.modals.actions.close();
      return;
    }

    throw new Error(`Unhandled modal kind for delete confirm: ${kind}`);
  };

  const runNewSessionSubmit = async () => {
    const name = deps.home.state.newSessionName.trim();
    if (!name) return;
    deps.modals.actions.close();
    await deps.session.actions.createSession(name);
  };

  const runNewSessionChoice = async (choice: 'create' | 'cancel') => {
    deps.input.actions.set({ newSessionFocus: choice });
    if (choice === 'cancel') {
      deps.modals.actions.close();
      return;
    }
    await runNewSessionSubmit();
  };

  return {
    'modals.openHelp': () => {
      deps.modals.actions.open('help');
    },
    'modals.close': () => {
      deps.modals.actions.close();
    },
    'modals.newSessionFocusDown': () => {
      if (deps.input.state.newSessionFocus === 'input') {
        deps.input.actions.set({ newSessionFocus: 'create' });
      }
    },
    'modals.newSessionFocusUp': () => {
      deps.input.actions.set({ newSessionFocus: 'input' });
    },
    'modals.newSessionToggleButton': () => {
      const focus = deps.input.state.newSessionFocus;
      if (focus === 'cancel') {
        deps.input.actions.set({ newSessionFocus: 'create' });
      } else {
        deps.input.actions.set({ newSessionFocus: 'cancel' });
      }
    },
    'modals.newSessionSubmit': async () => {
      if (deps.input.state.newSessionFocus === 'cancel') {
        deps.modals.actions.close();
        return;
      }
      await runNewSessionSubmit();
    },
    'modals.newSessionCreate': () => runNewSessionChoice('create'),
    'modals.newSessionCancel': () => runNewSessionChoice('cancel'),
    'modals.closeConfirmCycleLeft': () => {
      const choice = deps.input.state.closeConfirmChoice;
      if (choice === 'save') {
        deps.input.actions.set({ closeConfirmChoice: 'cancel' });
      } else if (choice === 'cancel') {
        deps.input.actions.set({ closeConfirmChoice: 'discard' });
      } else {
        deps.input.actions.set({ closeConfirmChoice: 'save' });
      }
    },
    'modals.closeConfirmCycleRight': () => {
      const choice = deps.input.state.closeConfirmChoice;
      if (choice === 'save') {
        deps.input.actions.set({ closeConfirmChoice: 'discard' });
      } else if (choice === 'discard') {
        deps.input.actions.set({ closeConfirmChoice: 'cancel' });
      } else {
        deps.input.actions.set({ closeConfirmChoice: 'save' });
      }
    },
    'modals.closeConfirmActivate': async () => {
      return runCloseConfirm(deps.input.state.closeConfirmChoice);
    },
    'modals.closeConfirmSave': () => runCloseConfirm('save'),
    'modals.closeConfirmDiscard': () => runCloseConfirm('discard'),
    'modals.closeConfirmCancel': () => runCloseConfirm('cancel'),
    'modals.deleteConfirmToggleChoice': () => {
      const next =
        deps.input.state.deleteConfirmChoice === 'confirm' ? 'cancel' : 'confirm';
      deps.input.actions.set({ deleteConfirmChoice: next });
    },
    'modals.deleteConfirmActivate': async () => {
      return runDeleteConfirm(deps.input.state.deleteConfirmChoice === 'confirm' ? 'confirm' : 'cancel');
    },
    'modals.deleteConfirmConfirm': () => runDeleteConfirm('confirm'),
    'modals.deleteConfirmCancel': () => runDeleteConfirm('cancel'),
  };
}
