import { useEffect, useMemo, type RefObject } from 'react';
import type { CommandId } from '../input/commands/spec';
import type { InputDomain } from '../domains/input/inputDomain';
import type { HomeDomainState, HomeDomainActions } from '../domains/home/homeDomain';
import type { ModalDomainState, ModalDomainActions, ModalPayload } from '../domains/modals/modalDomain';
import type { ErrorController } from './useErrors';
import { HelpModal } from './HelpModal';

type ModalLayerProps = {
  input: InputDomain;
  home: { state: HomeDomainState; actions: HomeDomainActions };
  modals: { state: ModalDomainState; actions: ModalDomainActions };
  errors: ErrorController;
  runCommand: (id: CommandId) => void;
  refs: {
    newSessionInputRef: RefObject<HTMLInputElement>;
  };
};

type BucketTagPayload = Extract<NonNullable<ModalPayload>, { type: 'bucket' | 'tag' }>;
type ClipPayload = Extract<NonNullable<ModalPayload>, { type: 'clip' }>;
type MarkerPayload = Extract<NonNullable<ModalPayload>, { markerIds: string[] }>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBucketTagPayload(payload: unknown, expectedType: 'bucket' | 'tag'): payload is BucketTagPayload {
  if (!isObject(payload)) return false;
  if (payload.type !== expectedType) return false;
  return (
    typeof payload.id === 'string' &&
    typeof payload.name === 'string' &&
    typeof payload.referenceCount === 'number'
  );
}

function isClipPayload(payload: unknown): payload is ClipPayload {
  if (!isObject(payload)) return false;
  if (payload.type !== 'clip') return false;
  return (
    typeof payload.id === 'string' &&
    typeof payload.name === 'string' &&
    typeof payload.markerCount === 'number' &&
    typeof payload.eventCount === 'number'
  );
}

function isMarkerPayload(payload: unknown): payload is MarkerPayload {
  if (!isObject(payload)) return false;
  if (!Array.isArray(payload.markerIds)) return false;
  if (payload.markerIds.some((id) => typeof id !== 'string')) return false;
  if (payload.note !== undefined && typeof payload.note !== 'string') return false;
  return true;
}

export function ModalLayer(props: ModalLayerProps): JSX.Element {
  const { input, home, modals, errors, runCommand, refs } = props;

  const highlightedHomeSession = useMemo(() => {
    if (!input.state.homeHighlightedSessionId) return null;
    return home.state.visibleSessions.find((session) => session.sessionId === input.state.homeHighlightedSessionId) ?? null;
  }, [home.state.visibleSessions, input.state.homeHighlightedSessionId]);

  const bucketPayload = useMemo(() => {
    return isBucketTagPayload(modals.state.payload as unknown, 'bucket') ? modals.state.payload as BucketTagPayload : null;
  }, [modals.state.payload]);

  const tagPayload = useMemo(() => {
    return isBucketTagPayload(modals.state.payload as unknown, 'tag') ? modals.state.payload as BucketTagPayload : null;
  }, [modals.state.payload]);

  const markerPayload = useMemo(() => {
    return isMarkerPayload(modals.state.payload as unknown) ? modals.state.payload as MarkerPayload : null;
  }, [modals.state.payload]);

  const clipPayload = useMemo(() => {
    return isClipPayload(modals.state.payload as unknown) ? modals.state.payload as ClipPayload : null;
  }, [modals.state.payload]);

  useEffect(() => {
    if (input.state.homeMode !== 'deleteConfirm') return;
    if (!input.state.homeHighlightedSessionId) return;
    if (highlightedHomeSession) return;
    errors.set('Highlighted session not found for delete confirmation.');
    input.actions.set({
      homeMode: 'list',
      homeHighlightedSessionId: null,
      homeDeleteChoice: 'cancel',
      homeSessionButtonFocus: 'open',
    });
  }, [
    errors.set,
    highlightedHomeSession,
    input.actions.set,
    input.state.homeHighlightedSessionId,
    input.state.homeMode,
  ]);

  const closeModal = modals.actions.close;
  useEffect(() => {
    const kind = input.state.modalKind;
    if (kind === 'bucketDeleteConfirm' && !bucketPayload) {
      errors.set('Bucket delete confirm missing payload.');
      closeModal();
      return;
    }
    if (kind === 'tagDeleteConfirm' && !tagPayload) {
      errors.set('Tag delete confirm missing payload.');
      closeModal();
      return;
    }
    if (kind === 'markerDeleteConfirm' && !markerPayload) {
      errors.set('Marker delete confirm missing payload.');
      closeModal();
      return;
    }
    if (kind === 'clipDeleteConfirm' && !clipPayload) {
      errors.set('Clip delete confirm missing payload.');
      closeModal();
      return;
    }
  }, [bucketPayload, clipPayload, closeModal, errors.set, input.state.modalKind, markerPayload, tagPayload]);

  return (
    <>
      {input.state.modalKind === 'closeConfirm' && (
        <div className="app__modal-overlay">
          <div className="app__modal">
            <h3 className="app__modal-title">Unsaved Changes</h3>
            <p className="app__modal-message">
              You have unsaved changes. What would you like to do?
            </p>
            <div className="app__modal-actions">
              <button
                className={`app__btn app__btn--primary ${input.state.closeConfirmChoice === 'save' ? 'app__btn--highlighted' : ''}`}
                onClick={() => runCommand('modals.closeConfirmSave')}
              >
                Save
              </button>
              <button
                className={`app__btn app__btn--danger ${input.state.closeConfirmChoice === 'discard' ? 'app__btn--highlighted' : ''}`}
                onClick={() => runCommand('modals.closeConfirmDiscard')}
              >
                Discard
              </button>
              <button
                className={`app__btn app__btn--ghost ${input.state.closeConfirmChoice === 'cancel' ? 'app__btn--highlighted' : ''}`}
                onClick={() => runCommand('modals.closeConfirmCancel')}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {input.state.modalKind === 'bucketDeleteConfirm' && bucketPayload && (
        <div className="app__modal-overlay">
          <div className="app__modal">
            <h3 className="app__modal-title">Confirm Delete</h3>
            <p className="app__modal-message">
              The {bucketPayload.type} "{bucketPayload.name}" is used by {bucketPayload.referenceCount} marker{bucketPayload.referenceCount === 1 ? '' : 's'}.
              Deleting it will remove this {bucketPayload.type} from {bucketPayload.referenceCount === 1 ? 'that marker' : 'those markers'}.
            </p>
            <div className="app__modal-actions">
              <button
                className={`app__btn app__btn--danger ${input.state.deleteConfirmChoice === 'confirm' ? 'app__btn--highlighted' : ''}`}
                onClick={() => runCommand('modals.deleteConfirmConfirm')}
              >
                Delete
              </button>
              <button
                className={`app__btn app__btn--ghost ${input.state.deleteConfirmChoice === 'cancel' ? 'app__btn--highlighted' : ''}`}
                onClick={() => runCommand('modals.deleteConfirmCancel')}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {input.state.modalKind === 'tagDeleteConfirm' && tagPayload && (
        <div className="app__modal-overlay">
          <div className="app__modal">
            <h3 className="app__modal-title">Confirm Delete</h3>
            <p className="app__modal-message">
              The {tagPayload.type} "{tagPayload.name}" is used by {tagPayload.referenceCount} marker{tagPayload.referenceCount === 1 ? '' : 's'}.
              Deleting it will remove this {tagPayload.type} from {tagPayload.referenceCount === 1 ? 'that marker' : 'those markers'}.
            </p>
            <div className="app__modal-actions">
              <button
                className={`app__btn app__btn--danger ${input.state.deleteConfirmChoice === 'confirm' ? 'app__btn--highlighted' : ''}`}
                onClick={() => runCommand('modals.deleteConfirmConfirm')}
              >
                Delete
              </button>
              <button
                className={`app__btn app__btn--ghost ${input.state.deleteConfirmChoice === 'cancel' ? 'app__btn--highlighted' : ''}`}
                onClick={() => runCommand('modals.deleteConfirmCancel')}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {input.state.modalKind === 'markerDeleteConfirm' && markerPayload && (
        <div className="app__modal-overlay">
          <div className="app__modal">
            <h3 className="app__modal-title">
              Delete Marker{markerPayload.markerIds.length > 1 ? 's' : ''}
            </h3>
            <p className="app__modal-message">
              {markerPayload.markerIds.length === 1
                ? `Are you sure you want to delete this marker${markerPayload.note ? ` ("${markerPayload.note}")` : ''}?`
                : `Are you sure you want to delete ${markerPayload.markerIds.length} markers?`}
            </p>
            <div className="app__modal-actions">
              <button
                className={`app__btn app__btn--danger ${input.state.deleteConfirmChoice === 'confirm' ? 'app__btn--highlighted' : ''}`}
                onClick={() => runCommand('modals.deleteConfirmConfirm')}
              >
                Delete
              </button>
              <button
                className={`app__btn app__btn--ghost ${input.state.deleteConfirmChoice === 'cancel' ? 'app__btn--highlighted' : ''}`}
                onClick={() => runCommand('modals.deleteConfirmCancel')}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {input.state.modalKind === 'clipDeleteConfirm' && clipPayload && (
        <div className="app__modal-overlay">
          <div className="app__modal">
            <h3 className="app__modal-title">Remove Clip</h3>
            <p className="app__modal-message">
              "{clipPayload.name}" has {clipPayload.markerCount} marker{clipPayload.markerCount === 1 ? '' : 's'}{clipPayload.eventCount > 0 ? ` and ${clipPayload.eventCount} event${clipPayload.eventCount === 1 ? '' : 's'}` : ''}.
              Removing this clip will delete {clipPayload.markerCount === 1 && clipPayload.eventCount === 0 ? 'that marker' : 'all associated data'}.
            </p>
            <div className="app__modal-actions">
              <button
                className={`app__btn app__btn--danger ${input.state.deleteConfirmChoice === 'confirm' ? 'app__btn--highlighted' : ''}`}
                onClick={() => runCommand('modals.deleteConfirmConfirm')}
              >
                Remove
              </button>
              <button
                className={`app__btn app__btn--ghost ${input.state.deleteConfirmChoice === 'cancel' ? 'app__btn--highlighted' : ''}`}
                onClick={() => runCommand('modals.deleteConfirmCancel')}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {input.state.modalKind === 'newSession' && (
        <div className="app__modal-overlay">
          <div className="app__modal">
            <h3 className="app__modal-title">New Session</h3>
            <p className="app__modal-message">
              Enter a name for your new session:
            </p>
            <input
              ref={refs.newSessionInputRef}
              type="text"
              className="app__modal-input"
              value={home.state.newSessionName}
              onChange={(e) => home.actions.setNewSessionName(e.target.value)}
              onFocus={() => input.actions.set({ newSessionFocus: 'input' })}
              placeholder="Session name"
              autoFocus
            />
            <div className="app__modal-actions">
              <button
                className={`app__btn app__btn--primary ${input.state.newSessionFocus === 'create' ? 'app__btn--highlighted' : ''}`}
                onClick={() => runCommand('modals.newSessionCreate')}
                disabled={!home.state.newSessionName.trim()}
              >
                Create
              </button>
              <button
                className={`app__btn app__btn--ghost ${input.state.newSessionFocus === 'cancel' ? 'app__btn--highlighted' : ''}`}
                onClick={() => runCommand('modals.newSessionCancel')}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {input.state.modalKind === 'help' && (
        <HelpModal onClose={() => runCommand('modals.close')} />
      )}

      {input.state.workspace === 'home' && input.state.homeMode === 'deleteConfirm' && highlightedHomeSession && (
        <div className="app__modal-overlay">
          <div className="app__modal">
            <h3 className="app__modal-title">Delete Session</h3>
            <p className="app__modal-message">
              Are you sure you want to delete the session "{highlightedHomeSession.name}"?
              This action cannot be undone.
            </p>
            <div className="app__modal-actions">
              <button
                className={`app__btn app__btn--danger ${input.state.homeDeleteChoice === 'confirm' ? 'app__btn--highlighted' : ''}`}
                onClick={() => runCommand('home.deleteConfirmConfirm')}
              >
                Delete
              </button>
              <button
                className={`app__btn app__btn--ghost ${input.state.homeDeleteChoice === 'cancel' ? 'app__btn--highlighted' : ''}`}
                onClick={() => runCommand('home.deleteConfirmCancel')}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
