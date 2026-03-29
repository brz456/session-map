import { useCallback, useState } from 'react';
import type { SessionUiSnapshot } from '../../../shared/ipc/sessionUi';
import { exportAllMarkerMedia } from '../../export/exportCoordinator';
import type { AppCommonDeps } from '../../app/appDeps';

export interface ExportDomainState {
  isExporting: boolean;
}

export interface ExportDomainActions {
  exportAll(session: SessionUiSnapshot): Promise<void>;
}

export function useExportDomain(deps: AppCommonDeps): {
  state: ExportDomainState;
  actions: ExportDomainActions;
} {
  const [isExporting, setIsExporting] = useState(false);

  const exportAll = useCallback(
    async (session: SessionUiSnapshot) => {
      if (session.markers.length === 0) {
        deps.errors.set('No markers to export');
        return;
      }

      setIsExporting(true);
      try {
        const result = await exportAllMarkerMedia(
          { session: deps.api.session, media: deps.api.media },
          session
        );
        const stillsMsg = `Stills: ${result.stills.exported} exported, ${result.stills.skipped} skipped, ${result.stills.failed} failed`;
        const clipsMsg = `Clips: ${result.clips.exported} exported, ${result.clips.skipped} skipped, ${result.clips.failed} failed`;
        console.log(`Export complete. ${stillsMsg}. ${clipsMsg}`);
        if (result.stills.failed > 0 || result.clips.failed > 0) {
          deps.errors.set(`Export completed with errors. ${stillsMsg}. ${clipsMsg}`);
        }
      } catch (err) {
        deps.errors.set(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIsExporting(false);
      }
    },
    [deps.api.media, deps.api.session, deps.errors]
  );

  return {
    state: { isExporting },
    actions: { exportAll },
  };
}
