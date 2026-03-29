import type { PartialCommandRegistry } from '../../input/commands/registry';
import type { InputDomain } from './inputDomain';

export function createInputCommands(deps: {
  input: InputDomain;
  dom: { blurActiveElement(): void };
  refs: {
    noteTextareaRef: React.RefObject<HTMLTextAreaElement>;
  };
}): PartialCommandRegistry {
  return {
    'input.exitToPlayerMode': () => {
      deps.refs.noteTextareaRef.current?.blur();
      deps.dom.blurActiveElement();
      deps.input.actions.resetToPlayerMode();
    },
    'input.noop': () => {},
    'input.blockUnlessTyping': () => {},
  };
}
