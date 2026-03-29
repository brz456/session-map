import type { WorkspaceId } from '../input/modes';

export interface AppViewProps {
  workspace: WorkspaceId;
  home: JSX.Element;
  session: JSX.Element;
  processing: JSX.Element;
}

export function AppView(props: AppViewProps): JSX.Element {
  const { workspace, home, session, processing } = props;
  switch (workspace) {
    case 'home':
      return home;
    case 'session':
      return session;
    case 'processing':
      return processing;
    default: {
      const _exhaustive: never = workspace;
      throw new Error(`Unhandled workspace: ${_exhaustive}`);
    }
  }
}
