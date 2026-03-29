import type { PartialCommandRegistry } from '../../input/commands/registry';
import type { ExportDomainState, ExportDomainActions } from './exportDomain';
import type { SessionDomainState } from '../session/sessionDomain';

export function createExportCommands(deps: {
  export: { state: ExportDomainState; actions: ExportDomainActions };
  session: { state: SessionDomainState };
}): PartialCommandRegistry {
  return {
    'export.startAll': async () => {
      if (deps.export.state.isExporting) return;
      const session = deps.session.state.session;
      if (!session) return;
      await deps.export.actions.exportAll(session);
    },
  };
}
