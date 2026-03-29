import type { SessionPackage } from '../../../shared/sessionPackage/types';
import type { SessionUpdateResult } from '../../../shared/ipc/types';

export type CommitValidatedFn = (
  nextSession: unknown,
  options?: { bumpUiRevision?: boolean }
) => SessionUpdateResult;

export type SessionStoreMutatorContext = {
  getCurrentSession(): SessionPackage | null;
  setCurrentSession(session: SessionPackage | null): void;
  getCurrentSessionDir(): string | null;
  setCurrentSessionDir(dir: string | null): void;
  getUiRevision(): number;
  bumpUiRevision(): number;
  commitValidated: CommitValidatedFn;
};
