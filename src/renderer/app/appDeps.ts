import type { RendererApi } from './rendererApi';
import type { ErrorController } from './useErrors';
import type { FeedbackController } from './useFeedback';
import type { UseSessionPersistenceResult } from '../session/useSessionPersistence';

export interface AppBaseDeps {
  api: RendererApi;
  errors: ErrorController;
  feedback: FeedbackController;
}

export interface AppCommonDeps extends AppBaseDeps {
  persistence: UseSessionPersistenceResult;
}
