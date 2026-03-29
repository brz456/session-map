// src/renderer/input/modes.ts
// Explicit mode types for deterministic keyboard routing

// Workspaces = major app areas (future-proofed)
export type WorkspaceId = 'home' | 'session' | 'processing';

// Viewports = primary interactive surface inside a workspace
export type SessionViewportKind = 'video' | 'browser' | 'whiteboard';

export type HomeMode = 'list' | 'search' | 'deleteConfirm';

export type SessionMode = 'player' | 'buckets' | 'tags' | 'markerList' | 'note' | 'drawing' | 'clips';

export type ModalKind =
  | 'none'
  | 'help'
  | 'closeConfirm'
  | 'newSession'
  | 'bucketDeleteConfirm'
  | 'tagDeleteConfirm'
  | 'markerDeleteConfirm'
  | 'clipDeleteConfirm';

export interface InputState {
  workspace: WorkspaceId;

  homeMode: HomeMode;
  sessionMode: SessionMode;
  sessionViewport: SessionViewportKind;

  modalKind: ModalKind;

  homeHighlightedSessionId: string | null;
  homeSessionButtonFocus: 'open' | 'delete';
  homeDeleteChoice: 'confirm' | 'cancel';
  closeConfirmChoice: 'save' | 'discard' | 'cancel';
  deleteConfirmChoice: 'confirm' | 'cancel';
  newSessionFocus: 'input' | 'create' | 'cancel';

  highlightedBucketId: string | null;
  highlightedTagId: string | null;
  highlightedMarkerId: string | null;
  markerListAnchorId: string | null; // For shift+arrow range selection in marker list mode
  highlightedClipIndex: number; // For clips mode navigation (-1 = none)

  bucketDraftTitle: string;
  tagDraftName: string;
}
