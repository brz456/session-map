import { registerDialogIpcHandlers } from "./dialog/dialogIpc";
import { registerMediaIpcHandlers } from "./media/mediaIpc";
import { registerSessionIpcHandlers } from "./session/registerSessionIpc";
import { registerAppFolderIpcHandlers } from "./appFolder/registerAppFolderIpc";

export async function registerIpcHandlers(): Promise<void> {
  registerDialogIpcHandlers();
  registerMediaIpcHandlers();
  registerSessionIpcHandlers();
  registerAppFolderIpcHandlers();

  const { registerObsIpcHandlers } = await import("./obs/obsIpc");
  registerObsIpcHandlers();
}
