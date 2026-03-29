// src/main/obs/ObsEngine.ts
// OBS engine lifecycle management via obs-studio-node

import * as osn from 'obs-studio-node';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { app, BrowserWindow } from 'electron';
import {
  ObsInitOptions,
  ObsInitResult,
  ObsStartResult,
  ObsStopResult,
  OBS_START_TIMEOUT_MS,
  OBS_STOP_TIMEOUT_MS,
  ObsUnexpectedStopEvent,
} from '../../shared/ipc/types';
import { OBS_IPC_EVENTS } from '../../shared/ipc/channels';
import { OSN_SIGNAL_NAMES } from './osnSurface';
import {
  ObsCapture,
  CaptureConfig,
  type ObsCaptureIpcSupervisor,
} from './ObsCapture';
import {
  ObsVideoFormat,
  ObsColorSpace,
  ObsColorRange,
  ObsScaleType,
  ObsFpsType,
  ObsSpeakerLayout,
} from './obsEnums';
import { hasSupportedMediaExtension } from '../../shared/mediaExtensions';
import { OBS_IPC_ERROR_SIGNATURE } from './obsIpcError';
import { toAsarUnpackedPath } from '../app/asarPath';

// Recording output settings (explicit constants per PRD Section 8)
const RECORDING_ENCODER = 'nvenc';
const RECORDING_FORMAT = 'mp4';
const RECORDING_BITRATE = 6000;
const FINALIZE_RENAME_RETRY_COUNT = 3;
const FINALIZE_RENAME_RETRY_DELAY_MS = 1000;
const RETRYABLE_RENAME_ERROR_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOENT']);
const OBS_STOP_WARN_TIMEOUT_MS = 30_000;

export type ObsEngineErrorCode =
  | 'callback_removal_failed'
  | 'shutdown_failed';

export type ObsEngineError = {
  code: ObsEngineErrorCode;
  message: string;
};

type RecordingState = 'idle' | 'starting' | 'recording' | 'stopping' | 'unknown';

export class ObsEngine implements ObsCaptureIpcSupervisor {
  private initialized = false;
  private initOptions: ObsInitOptions | null = null;
  private recordingState: RecordingState = 'idle';
  private writeErrorOccurred = false;
  private outputDir: string | null = null;
  private capture: ObsCapture | null = null;
  private activeSignalHandler: ((info: osn.EOutputSignal) => void) | null = null;
  private videoContext: osn.IVideo | null = null;
  private osnHosted = false;

  // Pending operation resolvers for single-handler architecture
  private pendingStartResolve: ((result: ObsStartResult) => void) | null = null;
  private pendingStopResolve: ((result: ObsStopResult) => void) | null = null;
  private pendingStartPromise: Promise<ObsStartResult> | null = null;
  private pendingStopPromise: Promise<ObsStopResult> | null = null;
  private startTimeoutId: NodeJS.Timeout | null = null;
  private stopWarnTimeoutId: NodeJS.Timeout | null = null;
  private stopTimeoutId: NodeJS.Timeout | null = null;
  private handlingFatalIpc = false;

  // Fatal error message to surface when state is 'unknown'
  private fatalErrorMessage: string | null = null;

  /**
   * Notify all renderer windows that OBS stopped unexpectedly so they can
   * clean up session state and recover.
   */
  private broadcastUnexpectedStop(event: ObsUnexpectedStopEvent): void {
    const windows = BrowserWindow.getAllWindows();
    for (const window of windows) {
      if (window.isDestroyed()) {
        continue;
      }
      const { webContents } = window;
      if (webContents.isDestroyed()) {
        continue;
      }
      try {
        webContents.send(OBS_IPC_EVENTS.recordingUnexpectedStop, event);
      } catch (err) {
        console.warn(
          '[ObsEngine] best-effort unexpected-stop broadcast failed:',
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  private isObsIpcError(error: unknown): error is Error {
    return (
      error instanceof Error &&
      error.message.includes(OBS_IPC_ERROR_SIGNATURE)
    );
  }

  private clearStopTimers(): void {
    if (this.stopWarnTimeoutId) {
      clearTimeout(this.stopWarnTimeoutId);
      this.stopWarnTimeoutId = null;
    }
    if (this.stopTimeoutId) {
      clearTimeout(this.stopTimeoutId);
      this.stopTimeoutId = null;
    }
  }

  private clearStartTimers(): void {
    if (this.startTimeoutId) {
      clearTimeout(this.startTimeoutId);
      this.startTimeoutId = null;
    }
  }

  private resolvePendingStartFailure(message: string): void {
    this.pendingStartResolve?.({
      ok: false,
      code: 'start_failed',
      message,
    });
    this.pendingStartResolve = null;
    this.pendingStartPromise = null;
    this.clearStartTimers();
  }

  private resolvePendingStopFailure(message: string): void {
    this.pendingStopResolve?.({
      ok: false,
      code: 'stop_failed',
      message,
    });
    this.pendingStopResolve = null;
    this.pendingStopPromise = null;
    this.clearStopTimers();
  }

  private handleFatalObsIpcError(error: Error, context: string): void {
    if (this.handlingFatalIpc) {
      return;
    }
    this.handlingFatalIpc = true;

    try {
      const previousState = this.recordingState;
      const shouldBroadcastUnexpectedStop = previousState === 'recording';
      const contextMessage = `Fatal OBS IPC error (${context}): ${error.message}`;
      const fatalMessage = this.fatalErrorMessage
        ? `${this.fatalErrorMessage}. Additionally: ${contextMessage}`
        : contextMessage;
      this.fatalErrorMessage = fatalMessage;
      this.recordingState = 'unknown';

      this.resolvePendingStartFailure(fatalMessage);
      this.resolvePendingStopFailure(fatalMessage);

      if (shouldBroadcastUnexpectedStop) {
        this.broadcastUnexpectedStop({
          reason: 'ipc_fatal',
          message: fatalMessage,
        });
      }
      // Latch fatal fail-closed state; recovery is explicit via forceReset() API.
    } finally {
      this.handlingFatalIpc = false;
    }
  }

  onObsCaptureFatalIpcError(error: Error, context: string): void {
    this.handleFatalObsIpcError(error, `capture.${context}`);
  }

  /**
   * Best-effort teardown of partially-initialized OSN state.
   * Called on init failure to make retries idempotent.
   * Fails closed: if signal handler disconnect or IPC disconnect fails,
   * preserves fatal 'unknown' state (requires restart).
   */
  private teardownPartialInit(): void {
    // Track if any critical teardown fails
    let teardownFailed = false;

    // Disconnect signal handlers - use disconnectSignalHandler() for consistent fail-closed behavior
    // If it fails, recordingState becomes 'unknown' and fatalErrorMessage is set
    const disconnectResult = this.disconnectSignalHandler();
    if (!disconnectResult.ok) {
      teardownFailed = true;
    }

    // Release capture sources
    if (this.capture) {
      const captureReleaseResult = this.capture.release();
      if (captureReleaseResult.ok) {
        this.capture = null;
      } else {
        teardownFailed = true;
        if (this.fatalErrorMessage) {
          this.fatalErrorMessage = `${this.fatalErrorMessage}. Additionally: ${captureReleaseResult.message}`;
        } else {
          this.fatalErrorMessage = captureReleaseResult.message;
        }
        this.recordingState = 'unknown';
      }
    }

    // Destroy video context - fail closed on error, continue cleanup
    if (this.videoContext) {
      try {
        this.videoContext.destroy();
        this.videoContext = null;
      } catch (err) {
        teardownFailed = true;
        const videoError = `Failed to destroy video context: ${err instanceof Error ? err.message : String(err)}`;
        if (this.fatalErrorMessage) {
          this.fatalErrorMessage = `${this.fatalErrorMessage}. Additionally: ${videoError}`;
        } else {
          this.fatalErrorMessage = videoError;
        }
        this.recordingState = 'unknown';
        // Do NOT clear videoContext - we don't know if destroy succeeded
      }
    }

    // Disconnect IPC if we hosted it - fail closed on error
    if (this.osnHosted) {
      try {
        osn.NodeObs.InitShutdownSequence();
      } catch (err) {
        // Fail closed: IPC state is indeterminate
        teardownFailed = true;
        const ipcError = `Failed to run OBS shutdown sequence: ${err instanceof Error ? err.message : String(err)}`;
        if (this.fatalErrorMessage) {
          this.fatalErrorMessage = `${this.fatalErrorMessage}. Additionally: ${ipcError}`;
        } else {
          this.fatalErrorMessage = ipcError;
        }
        this.recordingState = 'unknown';
      }
      try {
        osn.NodeObs.IPC.disconnect();
        this.osnHosted = false;
      } catch (err) {
        teardownFailed = true;
        const ipcError = `Failed to disconnect IPC: ${err instanceof Error ? err.message : String(err)}`;
        if (this.fatalErrorMessage) {
          this.fatalErrorMessage = `${this.fatalErrorMessage}. Additionally: ${ipcError}`;
        } else {
          this.fatalErrorMessage = ipcError;
        }
        this.recordingState = 'unknown';
      }
    }

    // Reset flags - but preserve 'unknown' state if any teardown failed
    this.initOptions = null;
    this.writeErrorOccurred = false;
    this.pendingStartResolve = null;
    this.pendingStopResolve = null;
    this.pendingStartPromise = null;
    this.pendingStopPromise = null;
    this.clearStartTimers();
    this.clearStopTimers();

    // Only reset to 'idle' if all teardown succeeded; otherwise preserve fatal state
    if (!teardownFailed) {
      this.recordingState = 'idle';
      this.fatalErrorMessage = null;
    }
    // If teardownFailed, recordingState is 'unknown' and fatalErrorMessage is set
  }

  /**
   * Single persistent signal handler for the entire recording lifecycle.
   * Connected once when recording starts, disconnected only when back to 'idle' or 'unknown'.
   * Routes signals based on current recordingState.
   */
  private handleOutputSignal(info: osn.EOutputSignal): void {
    try {
      switch (this.recordingState) {
        case 'starting':
          this.handleSignalWhileStarting(info);
          break;
        case 'recording':
          this.handleSignalWhileRecording(info);
          break;
        case 'stopping':
          this.handleSignalWhileStopping(info);
          break;
        default:
          // 'idle' or 'unknown' - signals should not arrive, ignore
          break;
      }
    } catch (err) {
      const fatalError =
        err instanceof Error
          ? err
          : new Error(`Non-Error signal callback exception: ${String(err)}`);
      this.handleFatalObsIpcError(fatalError, 'signal.callback');
      return;
    }
  }

  private handleSignalWhileStarting(info: osn.EOutputSignal): void {
    if (info.signal === OSN_SIGNAL_NAMES.recordingStarted) {
      this.clearStartTimers();
      const now = Date.now();
      this.recordingState = 'recording';
      this.pendingStartResolve?.({
        ok: true,
        recordingStartedAtIso: new Date(now).toISOString(),
        recordingStartedAtEpochMs: now,
      });
      this.pendingStartResolve = null;
      this.pendingStartPromise = null;
      // Handler stays connected for 'recording' state
    } else if (info.signal === OSN_SIGNAL_NAMES.recordingStopped) {
      // Unexpected stop during start - fail closed
      this.clearStartTimers();
      // disconnectSignalHandler() sets 'unknown' + fatalErrorMessage on failure
      const disconnectResult = this.disconnectSignalHandler();
      if (disconnectResult.ok) {
        this.recordingState = 'idle';
        this.pendingStartResolve?.({
          ok: false,
          code: 'start_failed',
          message: `Recording stopped unexpectedly during startup with code ${info.code}`,
        });
      } else {
        // State already 'unknown' from disconnect failure
        this.pendingStartResolve?.({
          ok: false,
          code: 'start_failed',
          message: `Recording stopped unexpectedly during startup with code ${info.code}. Additionally: ${disconnectResult.error.message}`,
        });
      }
      this.pendingStartResolve = null;
      this.pendingStartPromise = null;
    } else if (info.signal === OSN_SIGNAL_NAMES.recordingWriteError) {
      // Write error during start - fail closed and attempt stop
      this.clearStartTimers();
      // disconnectSignalHandler() sets 'unknown' + fatalErrorMessage on failure
      const disconnectResult = this.disconnectSignalHandler();
      try {
        osn.NodeObs.OBS_service_stopRecording();
      } catch (err) {
        if (this.isObsIpcError(err)) {
          this.handleFatalObsIpcError(err, 'signal.start.writeError.stopRecording');
          return;
        }
        console.warn('[ObsEngine] best-effort stopRecording failed (write-error during start)', err);
      }
      if (disconnectResult.ok) {
        this.recordingState = 'idle';
        this.pendingStartResolve?.({
          ok: false,
          code: 'start_failed',
          message: 'Recording write error during startup',
        });
      } else {
        // State already 'unknown' from disconnect failure
        this.pendingStartResolve?.({
          ok: false,
          code: 'start_failed',
          message: `Recording write error during startup. Additionally: ${disconnectResult.error.message}`,
        });
      }
      this.pendingStartResolve = null;
      this.pendingStartPromise = null;
    }
  }

  private handleSignalWhileRecording(info: osn.EOutputSignal): void {
    if (info.signal === OSN_SIGNAL_NAMES.recordingStopped) {
      // Unexpected stop during recording - fail closed immediately
      // Set fatalErrorMessage before disconnect so it becomes primary cause
      this.fatalErrorMessage = `Recording stopped unexpectedly with code ${info.code}`;
      this.broadcastUnexpectedStop({
        reason: 'recording_stopped',
        obsCode: info.code,
        message: this.fatalErrorMessage,
      });
      this.recordingState = 'unknown';
      // disconnectSignalHandler() will append on failure, preserving our message
      this.disconnectSignalHandler();
      // No resolver to call - fatalErrorMessage will be surfaced on next API call
    } else if (info.signal === OSN_SIGNAL_NAMES.recordingWriteError) {
      // Write error during recording - fail closed immediately, attempt stop
      // Set fatalErrorMessage before disconnect so it becomes primary cause
      this.fatalErrorMessage = 'Recording write error occurred during recording';
      this.broadcastUnexpectedStop({
        reason: 'write_error',
        message: this.fatalErrorMessage,
      });
      this.recordingState = 'unknown';
      // disconnectSignalHandler() will append on failure, preserving our message
      this.disconnectSignalHandler();
      try {
        osn.NodeObs.OBS_service_stopRecording();
      } catch (err) {
        if (this.isObsIpcError(err)) {
          this.handleFatalObsIpcError(err, 'signal.recording.writeError.stopRecording');
          return;
        }
        console.warn('[ObsEngine] best-effort stopRecording failed (write-error during recording)', err);
      }
      // No resolver to call - fatalErrorMessage will be surfaced on next API call
    }
  }

  private handleSignalWhileStopping(info: osn.EOutputSignal): void {
    if (info.signal === OSN_SIGNAL_NAMES.recordingStopped) {
      this.clearStopTimers();

      if (info.code !== 0) {
        // disconnectSignalHandler() sets 'unknown' + fatalErrorMessage on failure
        const disconnectResult = this.disconnectSignalHandler();
        if (disconnectResult.ok) {
          this.recordingState = 'idle';
          this.pendingStopResolve?.({
            ok: false,
            code: 'stop_failed',
            message: `Recording stopped with error code ${info.code}`,
          });
        } else {
          // State already 'unknown' from disconnect failure
          this.pendingStopResolve?.({
            ok: false,
            code: 'stop_failed',
            message: `Recording stopped with error code ${info.code}. Additionally: ${disconnectResult.error.message}`,
          });
        }
        this.pendingStopResolve = null;
        this.pendingStopPromise = null;
        return;
      }

      // Fail closed if any write error occurred during recording
      if (this.writeErrorOccurred) {
        // disconnectSignalHandler() sets 'unknown' + fatalErrorMessage on failure
        const disconnectResult = this.disconnectSignalHandler();
        if (disconnectResult.ok) {
          this.recordingState = 'idle';
          this.pendingStopResolve?.({
            ok: false,
            code: 'stop_failed',
            message: 'Recording stopped but write errors occurred during recording',
          });
        } else {
          // State already 'unknown' from disconnect failure
          this.pendingStopResolve?.({
            ok: false,
            code: 'stop_failed',
            message: `Recording stopped but write errors occurred during recording. Additionally: ${disconnectResult.error.message}`,
          });
        }
        this.pendingStopResolve = null;
        this.pendingStopPromise = null;
        return;
      }

      // Finalize recording file (async), then disconnect
      this.finalizeRecordingFile().then((result) => {
        const activeStopResolve = this.pendingStopResolve;
        if (!activeStopResolve || this.recordingState !== 'stopping') {
          return;
        }

        // disconnectSignalHandler() sets 'unknown' + fatalErrorMessage on failure
        const disconnectResult = this.disconnectSignalHandler();
        if (this.pendingStopResolve !== activeStopResolve) {
          // Fatal path or another terminal transition already resolved this stop.
          return;
        }

        if (disconnectResult.ok) {
          this.recordingState = 'idle';
          activeStopResolve(result);
        } else {
          // State already 'unknown' from disconnect failure
          // Do NOT pass through success - fail closed
          activeStopResolve({
            ok: false,
            code: 'stop_failed',
            message: `Recording finalized but cleanup failed: ${disconnectResult.error.message}`,
          });
        }
        if (this.pendingStopResolve === activeStopResolve) {
          this.pendingStopResolve = null;
          this.pendingStopPromise = null;
        }
      });
    } else if (info.signal === OSN_SIGNAL_NAMES.recordingWriteError) {
      // Latch write error - will fail closed when stop signal arrives
      this.writeErrorOccurred = true;
    }
  }

  /**
   * Get the OBS working directory (where binaries are located)
   */
  private getOBSWorkingDirectory(): string {
    // obs-studio-node requires its working directory to be the module root (where binaries live)
    const moduleRoot = path.dirname(require.resolve('obs-studio-node/package.json'));
    return toAsarUnpackedPath(moduleRoot);
  }

  /**
   * Get the OBS data directory for settings and cache
   */
  private getOBSDataDirectory(): string {
    const dataPath = path.join(app.getPath('userData'), 'osn-data');
    // Use sync API since we're in initialization
    const fsSync = require('fs');
    if (!fsSync.existsSync(dataPath)) {
      fsSync.mkdirSync(dataPath, { recursive: true });
    }
    return dataPath;
  }

  async initialize(options: ObsInitOptions): Promise<ObsInitResult> {
    // Block initialization if in fatal 'unknown' state (require restart)
    if (this.recordingState === 'unknown') {
      return {
        ok: false,
        code: 'init_failed',
        message: this.fatalErrorMessage ?? 'Engine is in fatal state.',
      };
    }

    if (this.initialized) {
      // Check if options match prior initialization
      const prior = this.initOptions;
      if (
        prior &&
        prior.outputDir === options.outputDir &&
        prior.windowTitle === options.windowTitle &&
        prior.fps === options.fps &&
        prior.resolution.width === options.resolution.width &&
        prior.resolution.height === options.resolution.height
      ) {
        return { ok: true };
      }
      return {
        ok: false,
        code: 'init_failed',
        message: 'Already initialized with different options; call shutdown() then initialize() again.',
      };
    }

    try {
      console.log('[ObsEngine] Initializing OBS Studio Node...');

      // Initialize IPC connection with unique ID
      osn.NodeObs.IPC.host(`sessionmap-${crypto.randomUUID()}`);
      this.osnHosted = true;

      // Set working directory to OBS module location (critical for finding binaries)
      const workingDir = this.getOBSWorkingDirectory();
      osn.NodeObs.SetWorkingDirectory(workingDir);
      console.log('[ObsEngine] Working directory:', workingDir);

      // Get data directory for OBS settings/cache
      const dataDir = this.getOBSDataDirectory();
      console.log('[ObsEngine] Data directory:', dataDir);

      // Initialize OBS API (4th param is empty string per working example)
      const clientVersion = app.getVersion();
      const initResult = osn.NodeObs.OBS_API_initAPI('en-US', dataDir, clientVersion, '');
      if (initResult !== 0) {
        this.teardownPartialInit();
        return {
          ok: false,
          code: 'init_failed',
          message: `OBS API initialization failed with code ${initResult}`,
        };
      }

      // Create and configure video context using VideoFactory
      this.videoContext = osn.VideoFactory.create();
      this.videoContext.video = {
        fpsNum: options.fps,
        fpsDen: 1,
        baseWidth: options.resolution.width,
        baseHeight: options.resolution.height,
        outputWidth: options.resolution.width,
        outputHeight: options.resolution.height,
        // Use numeric enum values cast to OSN types (type definitions don't export enums properly)
        outputFormat: ObsVideoFormat.NV12 as unknown as osn.EVideoFormat,
        colorspace: ObsColorSpace.CS709 as unknown as osn.EColorSpace,
        range: ObsColorRange.Partial as unknown as osn.ERangeType,
        scaleType: ObsScaleType.Lanczos as unknown as osn.EScaleType,
        fpsType: ObsFpsType.Integer as unknown as osn.EFPSType,
      };

      // Configure audio settings
      osn.AudioFactory.audioContext = {
        sampleRate: 48000,
        speakers: ObsSpeakerLayout.Stereo as unknown as osn.ESpeakerLayout,
      };

      // Configure recording output settings
      const outputConfigResult = this.configureRecordingOutput(options.outputDir);
      if (!outputConfigResult.ok) {
        this.teardownPartialInit();
        return {
          ok: false,
          code: 'init_failed',
          message: outputConfigResult.message,
        };
      }

      // Setup capture sources - use window capture on the app's own window
      this.capture = new ObsCapture({ supervisor: this });
      const captureConfig: CaptureConfig = {
        sourceType: 'window',
        mode: 'primary',
        windowTitle: options.windowTitle,
      };
      console.log('[ObsEngine] Configuring window capture for:', options.windowTitle);
      const captureResult = await this.capture.configure(captureConfig);
      if (!captureResult.ok) {
        this.teardownPartialInit();
        return {
          ok: false,
          code: 'capture_setup_failed',
          message: captureResult.message,
        };
      }

      // Signal handlers are connected in startRecording() when needed
      // This avoids untracked handlers and double-connect issues

      // Store init options and output directory (recording subdirectory created on finalize)
      this.initOptions = options;
      this.outputDir = options.outputDir;
      this.initialized = true;
      console.log('[ObsEngine] Initialization complete');
      return { ok: true };
    } catch (err) {
      console.error('[ObsEngine] Initialization failed:', err);
      this.teardownPartialInit();
      return {
        ok: false,
        code: 'init_failed',
        message: `OBS initialization error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Apply a single OBS setting using get/modify/save pattern.
   * Fails closed if parameter is not found.
   */
  private applySetting(
    category: string,
    parameter: string,
    value: string | number
  ): { ok: true } | { ok: false; message: string } {
    try {
      const settingsResponse = osn.NodeObs.OBS_settings_getSettings(category) as {
        data: Array<{
          nameSubCategory: string;
          parameters: Array<{ name: string; currentValue: string | number }>;
        }>;
      };

      let found = false;
      for (const subcategory of settingsResponse.data) {
        for (const param of subcategory.parameters) {
          if (param.name === parameter) {
            param.currentValue = value;
            found = true;
          }
        }
      }

      if (!found) {
        return {
          ok: false,
          message: `OBS setting not found: ${category}.${parameter}`,
        };
      }

      osn.NodeObs.OBS_settings_saveSettings(category, settingsResponse.data);
      return { ok: true };
    } catch (err) {
      if (this.isObsIpcError(err)) {
        this.handleFatalObsIpcError(err, `settings.${category}.${parameter}`);
      }
      return {
        ok: false,
        message: `Failed to apply OBS setting ${category}.${parameter}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private configureRecordingOutput(outputDir: string): { ok: true } | { ok: false; message: string } {
    // Configure output settings using get/modify/save pattern
    // Set FilePath to base outputDir - OBS may add its own subdirectory structure
    // finalizeRecordingFile() will move the result to outputDir/recording/<original-filename>.mp4
    // RecQuality='Stream' ensures recording uses StreamEncoder/VBitrate (not OBS defaults)
    const settings: Array<[string, string, string | number]> = [
      ['Output', 'Mode', 'Simple'],
      ['Output', 'RecQuality', 'Stream'],
      ['Output', 'FilePath', outputDir],
      ['Output', 'RecFormat', RECORDING_FORMAT],
      ['Output', 'StreamEncoder', RECORDING_ENCODER],
      ['Output', 'VBitrate', RECORDING_BITRATE],
    ];

    for (const [category, parameter, value] of settings) {
      const result = this.applySetting(category, parameter, value);
      if (!result.ok) {
        return result;
      }
    }

    return { ok: true };
  }

  /**
   * Disconnects the active signal handler from OSN.
   * On failure, transitions to fatal 'unknown' state and appends to fatalErrorMessage.
   *
   * Call site contract:
   *   - If the call site has a success path (e.g., resolving ok: true), it MUST check
   *     disconnectResult.ok and block success on failure.
   *   - If the call site will set recordingState = 'idle', it MUST only do so when
   *     disconnectResult.ok; otherwise the state is already 'unknown'.
   *   - If the call site is already in a fatal path (state already 'unknown', no success
   *     path, no resolver), checking is optional since disconnect failure only appends
   *     to fatalErrorMessage.
   */
  private disconnectSignalHandler(): { ok: true } | { ok: false; error: ObsEngineError } {
    if (!this.activeSignalHandler) {
      return { ok: true };
    }

    try {
      osn.NodeObs.OBS_service_removeCallback();
      this.activeSignalHandler = null;
      return { ok: true };
    } catch (err) {
      // Fail closed: transition to fatal state since OSN callback state is indeterminate
      // Do NOT clear activeSignalHandler - we don't know if it was removed
      const errorMessage = `Failed to remove OSN callback: ${err instanceof Error ? err.message : String(err)}`;
      // Append to fatalErrorMessage to preserve primary cause (e.g., timeout reason)
      if (this.fatalErrorMessage) {
        this.fatalErrorMessage = `${this.fatalErrorMessage}. Additionally: ${errorMessage}`;
      } else {
        this.fatalErrorMessage = errorMessage;
      }
      this.recordingState = 'unknown';
      if (this.isObsIpcError(err)) {
        this.handleFatalObsIpcError(err, 'disconnectSignalHandler');
      }
      return {
        ok: false,
        error: {
          code: 'callback_removal_failed',
          message: `${errorMessage}. State is now unknown.`,
        },
      };
    }
  }

  async startRecording(): Promise<ObsStartResult> {
    if (!this.initialized) {
      return {
        ok: false,
        code: 'not_initialized',
        message: 'OBS engine is not initialized',
      };
    }

    // Fail closed if state is 'unknown' (surface fatal error)
    if (this.recordingState === 'unknown') {
      return {
        ok: false,
        code: 'start_failed',
        message: this.fatalErrorMessage ?? 'Recording state is unknown.',
      };
    }

    // Idempotent join: return in-flight start operation.
    if (this.recordingState === 'starting' && this.pendingStartPromise) {
      return this.pendingStartPromise;
    }

    // State machine: reject if not idle
    if (this.recordingState !== 'idle') {
      return {
        ok: false,
        code: 'start_failed',
        message: `Cannot start recording: state is '${this.recordingState}', expected 'idle'`,
      };
    }

    // Transition to 'starting' immediately to block concurrent calls
    this.recordingState = 'starting';
    this.writeErrorOccurred = false;
    this.fatalErrorMessage = null;
    // Clear any stale prior start join state before pre-start async work.
    this.pendingStartResolve = null;
    this.pendingStartPromise = null;
    this.clearStartTimers();

    // Ensure no stale signal handlers - fail closed if removal fails
    // Note: disconnectSignalHandler() sets recordingState = 'unknown' on failure
    const disconnectResult = this.disconnectSignalHandler();
    if (!disconnectResult.ok) {
      // State already set to 'unknown' by disconnectSignalHandler()
      return {
        ok: false,
        code: 'start_failed',
        message: `Cannot start recording: ${disconnectResult.error.message}`,
      };
    }

    // Ensure output directory exists (OBS will write directly here)
    try {
      await fs.mkdir(this.outputDir!, { recursive: true });
    } catch (err) {
      this.recordingState = 'idle';
      return {
        ok: false,
        code: 'start_failed',
        message: `Failed to prepare output directory: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    let resolveStart: ((result: ObsStartResult) => void) | null = null;
    const startPromise = new Promise<ObsStartResult>((resolve) => {
      resolveStart = resolve;
    });
    this.pendingStartPromise = startPromise;
    this.pendingStartResolve = (result: ObsStartResult) => {
      if (this.pendingStartPromise !== startPromise) {
        return;
      }
      resolveStart?.(result);
    };

    const settleStart = (result: ObsStartResult): void => {
      if (this.pendingStartPromise !== startPromise) {
        return;
      }
      this.pendingStartResolve = null;
      this.pendingStartPromise = null;
      this.clearStartTimers();
      resolveStart?.(result);
    };

    // Connect the persistent signal handler (bound to this instance)
    this.activeSignalHandler = (info: osn.EOutputSignal) => this.handleOutputSignal(info);
    try {
      osn.NodeObs.OBS_service_connectOutputSignals(this.activeSignalHandler);
    } catch (err) {
      // Failed to connect signals - clean up and fail closed
      if (this.isObsIpcError(err)) {
        this.handleFatalObsIpcError(err, 'start.connectOutputSignals');
        return startPromise;
      }
      this.activeSignalHandler = null;
      this.recordingState = 'idle';
      settleStart({
        ok: false,
        code: 'start_failed',
        message: `Failed to connect output signals: ${err instanceof Error ? err.message : String(err)}`,
      });
      return startPromise;
    }

    // Set timeout
    this.startTimeoutId = setTimeout(() => {
      if (this.pendingStartPromise !== startPromise) {
        return; // Already resolved by another path
      }

      // Best-effort stop to prevent OBS from recording without our knowledge
      try {
        osn.NodeObs.OBS_service_stopRecording();
      } catch (err) {
        if (this.isObsIpcError(err)) {
          this.handleFatalObsIpcError(err, 'start.timeout.stopRecording');
          return;
        }
        console.warn('[ObsEngine] best-effort stopRecording failed (start-timeout)', err);
      }

      // Transition to 'unknown' - OBS state is indeterminate
      // Capture local message before disconnect (disconnect may append on failure)
      const timeoutMessage = `Recording did not start within ${OBS_START_TIMEOUT_MS}ms`;
      this.fatalErrorMessage = timeoutMessage;
      this.recordingState = 'unknown';
      const disconnectResult = this.disconnectSignalHandler();
      // Build message using local timeoutMessage (fatalErrorMessage may have been appended to)
      let resultMessage = `${timeoutMessage}. Recording state is now unknown.`;
      if (!disconnectResult.ok) {
        resultMessage = `${timeoutMessage}. Additionally: ${disconnectResult.error.message}`;
      }
      settleStart({
        ok: false,
        code: 'start_timeout',
        message: resultMessage,
      });
    }, OBS_START_TIMEOUT_MS);

    // Start recording
    try {
      osn.NodeObs.OBS_service_startRecording();
    } catch (err) {
      this.clearStartTimers();
      if (this.isObsIpcError(err)) {
        this.handleFatalObsIpcError(err, 'start.startRecording');
        return startPromise;
      }
      // disconnectSignalHandler() sets recordingState = 'unknown' on failure
      const disconnectResult = this.disconnectSignalHandler();
      const startError = `Failed to start recording: ${err instanceof Error ? err.message : String(err)}`;
      if (disconnectResult.ok) {
        this.recordingState = 'idle';
        settleStart({
          ok: false,
          code: 'start_failed',
          message: startError,
        });
      } else {
        // State is 'unknown' - include disconnect failure and restart instruction
        settleStart({
          ok: false,
          code: 'start_failed',
          message: `${startError}. Additionally: ${disconnectResult.error.message}`,
        });
      }
    }

    return startPromise;
  }

  async stopRecording(): Promise<ObsStopResult> {
    if (!this.initialized) {
      return {
        ok: false,
        code: 'not_initialized',
        message: 'OBS engine is not initialized',
      };
    }

    // Fail closed if state is 'unknown' (surface fatal error)
    if (this.recordingState === 'unknown') {
      return {
        ok: false,
        code: 'stop_failed',
        message: this.fatalErrorMessage ?? 'Recording state is unknown.',
      };
    }

    // Idempotent join: return in-flight stop operation.
    if (this.recordingState === 'stopping' && this.pendingStopPromise) {
      return this.pendingStopPromise;
    }

    // State machine: only allow stop from 'recording' state
    if (this.recordingState !== 'recording') {
      return {
        ok: false,
        code: 'not_recording',
        message: `Cannot stop recording: state is '${this.recordingState}', expected 'recording'`,
      };
    }

    // Transition to 'stopping' immediately to block concurrent calls
    // Note: signal handler is already connected from startRecording, no disconnect/reconnect gap
    this.recordingState = 'stopping';

    const stopPromise = new Promise<ObsStopResult>((resolve) => {
      // Store resolver for use by signal handler
      this.pendingStopResolve = resolve;

      // Warn phase: diagnostics only; does not fail stop.
      this.stopWarnTimeoutId = setTimeout(() => {
        if (!this.pendingStopResolve) {
          return;
        }
        console.warn(
          `[ObsEngine] stopRecording still waiting after ${OBS_STOP_WARN_TIMEOUT_MS}ms`,
        );
      }, OBS_STOP_WARN_TIMEOUT_MS);

      // Set timeout - fail closed if stop signal not received
      this.stopTimeoutId = setTimeout(() => {
        if (!this.pendingStopResolve) return; // Already resolved

        // Best-effort stop to prevent OBS from recording without our knowledge
        try {
          osn.NodeObs.OBS_service_stopRecording();
        } catch (err) {
          if (this.isObsIpcError(err)) {
            this.handleFatalObsIpcError(err, 'stop.timeout.stopRecording');
            return;
          }
          console.warn('[ObsEngine] best-effort stopRecording failed (stop-timeout)', err);
        }

        // Transition to 'unknown' - OBS state is indeterminate
        // Capture local message before disconnect (disconnect may append on failure)
        const timeoutMessage = `Recording did not stop within ${OBS_STOP_TIMEOUT_MS}ms`;
        this.fatalErrorMessage = timeoutMessage;
        this.recordingState = 'unknown';
        const disconnectResult = this.disconnectSignalHandler();
        // Build message using local timeoutMessage (fatalErrorMessage may have been appended to)
        let resultMessage = `${timeoutMessage}. Recording state is now unknown.`;
        if (!disconnectResult.ok) {
          resultMessage = `${timeoutMessage}. Additionally: ${disconnectResult.error.message}`;
        }
        this.pendingStopResolve?.({
          ok: false,
          code: 'stop_timeout',
          message: resultMessage,
        });
        this.pendingStopResolve = null;
        this.pendingStopPromise = null;
        this.clearStopTimers();
      }, OBS_STOP_TIMEOUT_MS);

      // Issue stop command
      try {
        osn.NodeObs.OBS_service_stopRecording();
      } catch (err) {
        this.clearStopTimers();
        if (this.isObsIpcError(err)) {
          this.handleFatalObsIpcError(err, 'stop.stopRecording');
          return;
        }
        // Stop command failed - restore to 'recording' state (fail-closed)
        this.recordingState = 'recording';
        this.pendingStopResolve?.({
          ok: false,
          code: 'stop_failed',
          message: `Failed to stop recording: ${err instanceof Error ? err.message : String(err)}`,
        });
        this.pendingStopResolve = null;
        this.pendingStopPromise = null;
      }
    });
    this.pendingStopPromise = stopPromise;

    return stopPromise;
  }

  private async renameRecordingWithRetry(sourcePath: string, finalPath: string): Promise<void> {
    for (let attempt = 0; attempt < FINALIZE_RENAME_RETRY_COUNT; attempt += 1) {
      try {
        await fs.rename(sourcePath, finalPath);
        return;
      } catch (err) {
        const errorCode = (err as NodeJS.ErrnoException).code;
        const canRetry =
          typeof errorCode === 'string' &&
          RETRYABLE_RENAME_ERROR_CODES.has(errorCode) &&
          attempt < FINALIZE_RENAME_RETRY_COUNT - 1;
        if (!canRetry) {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, FINALIZE_RENAME_RETRY_DELAY_MS));
      }
    }
  }

  private async finalizeRecordingFile(): Promise<ObsStopResult> {
    const outputDir = this.outputDir!;
    const recordingDir = path.join(outputDir, 'recording');

    try {
      // Ensure recording subdirectory exists for final destination
      await fs.mkdir(recordingDir, { recursive: true });

      // Get the actual file path from OBS - fail closed if unavailable
      let lastRecording: string;
      try {
        const result = osn.NodeObs.OBS_service_getLastRecording();
        if (!result || typeof result !== 'string' || result.trim() === '') {
          return {
            ok: false,
            code: 'no_recording_file',
            message: 'OBS did not return a valid recording path',
          };
        }
        lastRecording = result;
        console.log('[ObsEngine] OBS last recording path:', lastRecording);
      } catch (err) {
        if (this.isObsIpcError(err)) {
          this.handleFatalObsIpcError(err, 'finalize.getLastRecording');
        }
        return {
          ok: false,
          code: 'no_recording_file',
          message: `Failed to get last recording path from OBS: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      const normalizedPath = path.normalize(lastRecording);

      // Security: enforce recording is inside session outputDir
      const resolvedRecording = path.resolve(normalizedPath).toLowerCase();
      const resolvedOutputDir = path.resolve(outputDir).toLowerCase();
      if (!resolvedRecording.startsWith(resolvedOutputDir + path.sep) && resolvedRecording !== resolvedOutputDir) {
        return {
          ok: false,
          code: 'no_recording_file',
          message: `OBS recording path is outside session output directory: ${normalizedPath}`,
        };
      }

      // Verify file exists
      try {
        await fs.access(normalizedPath);
      } catch {
        return {
          ok: false,
          code: 'no_recording_file',
          message: `OBS reported recording at ${normalizedPath} but file not found`,
        };
      }

      // Check extension
      if (!hasSupportedMediaExtension(normalizedPath)) {
        return {
          ok: false,
          code: 'unsupported_recording_extension',
          message: `Recording has unsupported extension: ${path.extname(normalizedPath)}`,
        };
      }

      // Move to recording directory, keeping original filename (timestamp-based)
      const originalFilename = path.basename(normalizedPath);
      const finalPath = path.join(recordingDir, originalFilename);

      if (normalizedPath !== finalPath) {
        try {
          await this.renameRecordingWithRetry(normalizedPath, finalPath);
          console.log('[ObsEngine] Moved recording to:', finalPath);
        } catch (renameErr) {
          return {
            ok: false,
            code: 'stop_failed',
            message: `Failed to move recording into session folder after retry budget: ${renameErr instanceof Error ? renameErr.message : String(renameErr)}`,
          };
        }
      }

      // Return relative path for storage in session.json
      const relativePath = `recording/${originalFilename}` as const;
      return {
        ok: true,
        obsRecordingPath: relativePath,
      };
    } catch (err) {
      return {
        ok: false,
        code: 'stop_failed',
        message: `Failed to finalize recording file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async shutdown(): Promise<{ ok: true } | { ok: false; error: ObsEngineError }> {
    // Fail closed: reject shutdown if recording lifecycle is not conclusively resolved
    if (this.recordingState === 'unknown') {
      return {
        ok: false,
        error: {
          code: 'shutdown_failed',
          message: 'Cannot shutdown: recording state is unknown. Force-quit may leave orphan processes.',
        },
      };
    }

    // Any non-idle state means recording may be active
    if (this.recordingState !== 'idle') {
      // If 'recording', attempt clean stop
      if (this.recordingState === 'recording') {
        const stopResult = await this.stopRecording();
        if (!stopResult.ok) {
          return {
            ok: false,
            error: {
              code: 'shutdown_failed',
              message: `Failed to stop recording during shutdown: ${stopResult.message}`,
            },
          };
        }
      } else {
        // 'starting' or 'stopping' - operation in flight, cannot safely shutdown
        return {
          ok: false,
          error: {
            code: 'shutdown_failed',
            message: `Cannot shutdown: recording operation in flight (state: '${this.recordingState}'). Wait for completion.`,
          },
        };
      }
    }

    const disconnectResult = this.disconnectSignalHandler();
    if (!disconnectResult.ok) {
      return {
        ok: false,
        error: {
          code: 'shutdown_failed',
          message: `Failed to disconnect signal handler: ${disconnectResult.error.message}`,
        },
      };
    }

    if (this.capture) {
      const captureReleaseResult = this.capture.release();
      if (captureReleaseResult.ok) {
        this.capture = null;
      } else {
        return {
          ok: false,
          error: {
            code: 'shutdown_failed',
            message: `Failed to release capture resources: ${captureReleaseResult.message}`,
          },
        };
      }
    }

    if (this.videoContext) {
      try {
        this.videoContext.destroy();
        this.videoContext = null;
      } catch (err) {
        // Do NOT clear videoContext - we don't know if destroy succeeded
        return {
          ok: false,
          error: {
            code: 'shutdown_failed',
            message: `Failed to destroy video context: ${err instanceof Error ? err.message : String(err)}`,
          },
        };
      }
    }

    if (this.initialized) {
      try {
        osn.NodeObs.InitShutdownSequence();
        osn.NodeObs.IPC.disconnect();
        this.initialized = false;
        this.initOptions = null;
        this.osnHosted = false;
        this.recordingState = 'idle';
        this.writeErrorOccurred = false;
        this.fatalErrorMessage = null;
        this.pendingStartResolve = null;
        this.pendingStopResolve = null;
        this.pendingStartPromise = null;
        this.pendingStopPromise = null;
        this.clearStartTimers();
        this.clearStopTimers();
      } catch (err) {
        if (this.isObsIpcError(err)) {
          this.handleFatalObsIpcError(err, 'shutdown.disconnect');
        }
        // Do NOT flip initialized/osnHosted = false - state is unknown
        return {
          ok: false,
          error: {
            code: 'shutdown_failed',
            message: `Failed OBS shutdown/disconnect sequence: ${err instanceof Error ? err.message : String(err)}`,
          },
        };
      }
    }

    return { ok: true };
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  isRecording(): boolean {
    return this.recordingState === 'recording';
  }

  /**
   * Force-reset the engine to a clean state.
   * Use when the engine is in 'unknown' state and user wants to retry without app restart.
   *
   * State is always reset to idle (so next initialize() can work).
   * Returns ok: false with error details if cleanup had issues (caller should surface to user).
   * Note: May leave orphan OBS processes if the previous IPC connection was truly stuck.
   */
  forceReset(): { ok: true } | { ok: false; code: 'cleanup_errors'; message: string; errors: string[] } {
    console.log('[ObsEngine] Force-resetting engine state...');
    const errors: string[] = [];

    // Clear any pending timeouts
    this.clearStartTimers();
    this.clearStopTimers();

    // Reject any pending operations
    if (this.pendingStartResolve) {
      this.pendingStartResolve({
        ok: false,
        code: 'start_failed',
        message: 'Force-reset during pending start operation',
      });
      this.pendingStartResolve = null;
      this.pendingStartPromise = null;
    }
    if (this.pendingStopResolve) {
      this.pendingStopResolve({
        ok: false,
        code: 'stop_failed',
        message: 'Force-reset during pending stop operation',
      });
      this.pendingStopResolve = null;
      this.pendingStopPromise = null;
    }

    // Attempt cleanup, tracking errors
    if (this.activeSignalHandler) {
      try {
        osn.NodeObs.OBS_service_removeCallback();
        this.activeSignalHandler = null;
      } catch (err) {
        errors.push(`Signal handler removal failed: ${err instanceof Error ? err.message : String(err)}`);
        this.activeSignalHandler = null; // Clear anyway to allow retry
      }
    }

    if (this.capture) {
      const captureReleaseResult = this.capture.release();
      if (captureReleaseResult.ok) {
        this.capture = null;
      } else {
        errors.push(captureReleaseResult.message);
        this.capture = null;
      }
    }

    if (this.videoContext) {
      try {
        this.videoContext.destroy();
        this.videoContext = null;
      } catch (err) {
        errors.push(`Video context destroy failed: ${err instanceof Error ? err.message : String(err)}`);
        this.videoContext = null; // Clear anyway to allow retry
      }
    }

    if (this.osnHosted) {
      try {
        osn.NodeObs.InitShutdownSequence();
      } catch (err) {
        errors.push(`OBS shutdown sequence failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      try {
        osn.NodeObs.IPC.disconnect();
      } catch (err) {
        errors.push(`IPC disconnect failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Reset all state to clean (always succeeds)
    this.initialized = false;
    this.initOptions = null;
    this.osnHosted = false;
    this.recordingState = 'idle';
    this.writeErrorOccurred = false;
    this.fatalErrorMessage = null;
    this.outputDir = null;
    this.pendingStartPromise = null;
    this.pendingStopPromise = null;

    if (errors.length > 0) {
      console.warn('[ObsEngine] Force-reset completed with errors:', errors);
      return {
        ok: false,
        code: 'cleanup_errors',
        message: `Force-reset completed but had ${errors.length} cleanup error(s)`,
        errors,
      };
    }

    console.log('[ObsEngine] Force-reset complete, state is now idle');
    return { ok: true };
  }
}
