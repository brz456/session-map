import type { PartialCommandRegistry } from '../../input/commands/registry';
import type { RecordingDomainActions, RecordingDomainState } from './recordingDomain';

export function createRecordingCommands(deps: {
  recording: { state: RecordingDomainState; actions: RecordingDomainActions };
}): PartialCommandRegistry {
  return {
    'recording.toggle': () => {
      if (deps.recording.state.recordingActive) {
        return deps.recording.actions.stopRecording();
      }
      return deps.recording.actions.startRecording();
    },
  };
}
