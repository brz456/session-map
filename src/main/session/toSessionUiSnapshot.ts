import type { SessionUiSnapshot } from '../../shared/ipc/sessionUi';
import type { SessionPackage } from '../../shared/sessionPackage/types';

export function toSessionUiSnapshot(session: SessionPackage): SessionUiSnapshot {
  return {
    ...session,
    telemetry: {
      events: [],
    },
  };
}
