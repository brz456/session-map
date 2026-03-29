// src/main/session/sessionStoreInstance.ts
// Singleton SessionStore instance - extracted to break circular dependencies
// between registerSessionIpc.ts and export modules.

import { SessionStore } from './SessionStore';

// Singleton instance - lazily created on first use
let sessionStoreInstance: SessionStore | null = null;

/**
 * Gets the singleton SessionStore instance.
 * Creates the instance on first call.
 */
export function getSessionStore(): SessionStore {
  if (!sessionStoreInstance) {
    sessionStoreInstance = new SessionStore();
  }
  return sessionStoreInstance;
}
