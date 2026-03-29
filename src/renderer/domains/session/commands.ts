import type { PartialCommandRegistry } from '../../input/commands/registry';
import type { InputDomain } from '../input/inputDomain';
import type { SessionDomain } from './sessionDomain';

export function createSessionCommands(deps: {
  input: InputDomain;
  session: SessionDomain;
  dom: { blurActiveElement(): void };
}): PartialCommandRegistry {
  return {
    'session.importMedia': () => deps.session.actions.importMediaFromDisk(),
    'session.goHome': () => {
      deps.dom.blurActiveElement();
      return deps.session.actions.closeSession();
    },
  };
}
