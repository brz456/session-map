// src/main/obs/ObsCapture.ts
// OBS capture source configuration (window/monitor + audio)

import * as osn from 'obs-studio-node';
import { ObsPropertyType } from './obsEnums';
import { OBS_IPC_ERROR_SIGNATURE } from './obsIpcError';

// Discriminated union for capture configuration
// Ensures windowTitle is required when sourceType is 'window'
export type CaptureConfig =
  | { sourceType: 'monitor'; mode: 'primary' }
  | { sourceType: 'window'; mode: 'primary'; windowTitle: string };

export type ObsCaptureConfigureErrorCode =
  | 'invalid_config'
  | 'capture_source_create_failed'
  | 'audio_source_create_failed'
  | 'scene_setup_failed';

export type ObsCaptureConfigureResult =
  | { ok: true }
  | { ok: false; code: ObsCaptureConfigureErrorCode; message: string };

export type ObsCaptureReleaseResult =
  | { ok: true }
  | { ok: false; message: string; errors: string[] };

export interface ObsCaptureIpcSupervisor {
  onObsCaptureFatalIpcError(error: Error, context: string): void;
}

// Window capture method constants (OBS window_capture source)
const WINDOW_CAPTURE_METHOD_WINDOWS_GRAPHICS_CAPTURE = 2;

export class ObsCapture {
  private scene: osn.IScene | null = null;
  private captureSource: osn.IInput | null = null;
  private desktopAudioSource: osn.IInput | null = null;
  private micSource: osn.IInput | null = null;
  private readonly supervisor: ObsCaptureIpcSupervisor | undefined;
  private fatalIpcReported = false;

  constructor(options: { supervisor?: ObsCaptureIpcSupervisor } = {}) {
    this.supervisor = options.supervisor;
  }

  private isObsIpcError(error: unknown): error is Error {
    return (
      error instanceof Error &&
      error.message.includes(OBS_IPC_ERROR_SIGNATURE)
    );
  }

  private reportFatalObsIpcError(error: Error, context: string): void {
    if (this.fatalIpcReported) {
      return;
    }
    this.fatalIpcReported = true;
    this.supervisor?.onObsCaptureFatalIpcError(error, context);
  }

  async configure(config: CaptureConfig): Promise<ObsCaptureConfigureResult> {
    this.fatalIpcReported = false;

    // Validate config first (fail-closed: invalid input returns error without side effects)
    if (config.mode !== 'primary') {
      return {
        ok: false,
        code: 'invalid_config',
        message: `Invalid capture config: mode=${config.mode}`,
      };
    }

    if (config.sourceType !== 'monitor' && config.sourceType !== 'window') {
      return {
        ok: false,
        code: 'invalid_config',
        message: `Invalid capture config: unknown sourceType="${(config as { sourceType: unknown }).sourceType}"`,
      };
    }

    if (config.sourceType === 'window') {
      const { windowTitle } = config;
      if (typeof windowTitle !== 'string' || windowTitle.trim() === '') {
        return {
          ok: false,
          code: 'invalid_config',
          message: 'windowTitle must be a non-empty string',
        };
      }
    }

    // Idempotent: release any existing resources before reconfiguring.
    // Fail closed if prior teardown is incomplete.
    const preReleaseResult = this.release();
    if (!preReleaseResult.ok) {
      return {
        ok: false,
        code: 'scene_setup_failed',
        message: `Failed to release previous capture resources: ${preReleaseResult.message}`,
      };
    }

    try {
      // Create scene
      this.scene = osn.SceneFactory.create('main-scene');
      if (!this.scene) {
        return {
          ok: false,
          code: 'scene_setup_failed',
          message: 'Failed to create OBS scene',
        };
      }

      // Create video capture source based on type
      // sourceType already validated above; branch is exhaustive
      const captureResult =
        config.sourceType === 'window'
          ? this.createWindowCapture(config.windowTitle.trim())
          : this.createMonitorCapture();
      if (!captureResult.ok) {
        const cleanupResult = this.release();
        if (!cleanupResult.ok) {
          return {
            ok: false,
            code: captureResult.code,
            message: `${captureResult.message}. Additionally, cleanup failed: ${cleanupResult.message}`,
          };
        }
        return captureResult;
      }

      // Create desktop audio capture
      const desktopAudioResult = this.createDesktopAudioCapture();
      if (!desktopAudioResult.ok) {
        const cleanupResult = this.release();
        if (!cleanupResult.ok) {
          return {
            ok: false,
            code: desktopAudioResult.code,
            message: `${desktopAudioResult.message}. Additionally, cleanup failed: ${cleanupResult.message}`,
          };
        }
        return desktopAudioResult;
      }

      // Create microphone capture
      const micResult = this.createMicrophoneCapture();
      if (!micResult.ok) {
        const cleanupResult = this.release();
        if (!cleanupResult.ok) {
          return {
            ok: false,
            code: micResult.code,
            message: `${micResult.message}. Additionally, cleanup failed: ${cleanupResult.message}`,
          };
        }
        return micResult;
      }

      // Set the scene as the current output source
      osn.Global.setOutputSource(0, this.scene);

      return { ok: true };
    } catch (err) {
      if (this.isObsIpcError(err)) {
        this.reportFatalObsIpcError(err, 'configure');
      }
      const cleanupResult = this.release();
      const baseMessage = `Failed to configure capture: ${err instanceof Error ? err.message : String(err)}`;
      if (!cleanupResult.ok) {
        return {
          ok: false,
          code: 'scene_setup_failed',
          message: `${baseMessage}. Additionally, cleanup failed: ${cleanupResult.message}`,
        };
      }
      return {
        ok: false,
        code: 'scene_setup_failed',
        message: baseMessage,
      };
    }
  }

  private createMonitorCapture(): ObsCaptureConfigureResult {
    try {
      // Use monitor_capture for Windows
      this.captureSource = osn.InputFactory.create('monitor_capture', 'monitor-source');
      if (!this.captureSource) {
        return {
          ok: false,
          code: 'capture_source_create_failed',
          message: 'Failed to create monitor capture source',
        };
      }

      // Configure for primary monitor (monitor index 0)
      const settings = this.captureSource.settings;
      settings.monitor = 0;
      settings.capture_cursor = true;
      this.captureSource.update(settings);

      // Add to scene
      const sceneItem = this.scene!.add(this.captureSource);
      if (!sceneItem) {
        return {
          ok: false,
          code: 'capture_source_create_failed',
          message: 'Failed to add monitor source to scene',
        };
      }

      return { ok: true };
    } catch (err) {
      if (this.isObsIpcError(err)) {
        this.reportFatalObsIpcError(err, 'createMonitorCapture');
      }
      return {
        ok: false,
        code: 'capture_source_create_failed',
        message: `Monitor capture error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Find a window token by exact title match.
   * Uses a dummy window_capture source to enumerate available windows.
   * Fails if zero or multiple windows match (deterministic).
   */
  private findWindowToken(windowTitle: string): { ok: true; token: string } | { ok: false; message: string } {
    let dummySource: osn.IInput | null = null;
    try {
      // Create a dummy source to enumerate windows without affecting the real capture
      dummySource = osn.InputFactory.create('window_capture', 'window-enum-dummy');
      if (!dummySource) {
        return { ok: false, message: 'Failed to create window enumeration source' };
      }

      // Find the 'window' property which contains the list of available windows
      let prop = dummySource.properties.first();
      while (prop && prop.name !== 'window') {
        prop = prop.next();
      }

      if (!prop || prop.name !== 'window') {
        return { ok: false, message: 'Could not find window property in OBS source' };
      }

      // Validate property is a list type
      // Cast needed: EPropertyType not exported by obs-studio-node, but values match
      if ((prop.type as number) !== ObsPropertyType.List) {
        return { ok: false, message: 'Window property is not a list type' };
      }

      // Structural validation for list property
      const listProp = prop as osn.IListProperty;
      if (!listProp.details || typeof listProp.details !== 'object') {
        return { ok: false, message: 'Window property has no details' };
      }

      const items = listProp.details.items;
      if (!items || !Array.isArray(items)) {
        return { ok: false, message: 'Window property has no items' };
      }

      // Match window title (case-insensitive)
      // OBS window names have format "[process.exe]: Title" - extract title portion
      const lowerTitle = windowTitle.toLowerCase();
      const matches = items.filter((item) => {
        const name = (item.name || '').toLowerCase();
        // Try exact match first
        if (name === lowerTitle) return true;
        // Try matching title portion after "]: " (OBS format: "[process.exe]: Title")
        const colonIndex = name.indexOf(']: ');
        if (colonIndex !== -1) {
          const titlePortion = name.slice(colonIndex + 3);
          return titlePortion === lowerTitle;
        }
        return false;
      });

      if (matches.length === 0) {
        return { ok: false, message: `No window found with exact title "${windowTitle}"` };
      }

      if (matches.length > 1) {
        return { ok: false, message: `Multiple windows match title "${windowTitle}" (found ${matches.length})` };
      }

      // value can be string | number per obs-studio-node types
      return { ok: true, token: String(matches[0].value) };
    } finally {
      if (dummySource) {
        try {
          dummySource.release();
        } catch (err) {
          if (this.isObsIpcError(err)) {
            this.reportFatalObsIpcError(err, 'findWindowToken.releaseDummy');
          }
          throw new Error(
            `Failed to release window enumeration source: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }

  private createWindowCapture(windowTitle: string): ObsCaptureConfigureResult {
    // windowTitle already validated and trimmed by configure()
    try {
      // Find the window token by enumerating available windows
      const findResult = this.findWindowToken(windowTitle);
      if (!findResult.ok) {
        return {
          ok: false,
          code: 'capture_source_create_failed',
          message: `${findResult.message}. Make sure the app window is visible.`,
        };
      }

      // Use window_capture for Windows
      this.captureSource = osn.InputFactory.create('window_capture', 'window-source');
      if (!this.captureSource) {
        return {
          ok: false,
          code: 'capture_source_create_failed',
          message: 'Failed to create window capture source',
        };
      }

      // Configure window capture using the token
      const settings = this.captureSource.settings;
      settings.window = findResult.token;
      settings.cursor = true;
      settings.method = WINDOW_CAPTURE_METHOD_WINDOWS_GRAPHICS_CAPTURE;
      this.captureSource.update(settings);

      // Add to scene
      const sceneItem = this.scene!.add(this.captureSource);
      if (!sceneItem) {
        return {
          ok: false,
          code: 'capture_source_create_failed',
          message: 'Failed to add window source to scene',
        };
      }

      return { ok: true };
    } catch (err) {
      if (this.isObsIpcError(err)) {
        this.reportFatalObsIpcError(err, 'createWindowCapture');
      }
      return {
        ok: false,
        code: 'capture_source_create_failed',
        message: `Window capture error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private createDesktopAudioCapture(): ObsCaptureConfigureResult {
    try {
      // Use wasapi_output_capture for Windows desktop audio
      this.desktopAudioSource = osn.InputFactory.create(
        'wasapi_output_capture',
        'desktop-audio'
      );
      if (!this.desktopAudioSource) {
        return {
          ok: false,
          code: 'audio_source_create_failed',
          message: 'Failed to create desktop audio capture source',
        };
      }

      // Set as global audio source (channel 1 for desktop audio)
      osn.Global.setOutputSource(1, this.desktopAudioSource);

      return { ok: true };
    } catch (err) {
      if (this.isObsIpcError(err)) {
        this.reportFatalObsIpcError(err, 'createDesktopAudioCapture');
      }
      return {
        ok: false,
        code: 'audio_source_create_failed',
        message: `Desktop audio capture error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private createMicrophoneCapture(): ObsCaptureConfigureResult {
    try {
      // Use wasapi_input_capture for Windows microphone
      this.micSource = osn.InputFactory.create(
        'wasapi_input_capture',
        'microphone'
      );
      if (!this.micSource) {
        return {
          ok: false,
          code: 'audio_source_create_failed',
          message: 'Failed to create microphone capture source',
        };
      }

      // Set as global audio source (channel 2 for mic)
      osn.Global.setOutputSource(2, this.micSource);

      return { ok: true };
    } catch (err) {
      if (this.isObsIpcError(err)) {
        this.reportFatalObsIpcError(err, 'createMicrophoneCapture');
      }
      return {
        ok: false,
        code: 'audio_source_create_failed',
        message: `Microphone capture error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  release(): ObsCaptureReleaseResult {
    const errors: string[] = [];

    const detachOutput = (channel: 0 | 1 | 2): void => {
      try {
        osn.Global.setOutputSource(channel, null as any);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`output[${channel}] detach: ${message}`);
        if (this.isObsIpcError(err)) {
          this.reportFatalObsIpcError(
            err,
            `release.detachOutput.${channel}`,
          );
        }
      }
    };

    const releaseResource = (
      label: string,
      resource: { release(): void } | null,
      clearRef: () => void,
    ): void => {
      if (!resource) {
        return;
      }
      try {
        resource.release();
        clearRef();
      } catch (err) {
        errors.push(
          `${label}: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (this.isObsIpcError(err)) {
          this.reportFatalObsIpcError(err, `release.${label}`);
        }
      }
    };

    if (this.scene || this.captureSource) {
      detachOutput(0);
    }
    if (this.desktopAudioSource) {
      detachOutput(1);
    }
    if (this.micSource) {
      detachOutput(2);
    }

    releaseResource('captureSource', this.captureSource, () => {
      this.captureSource = null;
    });
    releaseResource('desktopAudioSource', this.desktopAudioSource, () => {
      this.desktopAudioSource = null;
    });
    releaseResource('micSource', this.micSource, () => {
      this.micSource = null;
    });
    releaseResource('scene', this.scene, () => {
      this.scene = null;
    });

    if (errors.length > 0) {
      return {
        ok: false,
        message: `ObsCapture release failed with ${errors.length} error(s): ${errors.join('; ')}`,
        errors,
      };
    }

    return { ok: true };
  }
}
