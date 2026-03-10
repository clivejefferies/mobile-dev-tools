export interface DeviceInfo {
  platform: string;
  id: string;
  osVersion: string;
  model: string;
  simulator: boolean;
}

export interface StartAppResponse {
  device: DeviceInfo;
  appStarted: boolean;
  launchTimeMs: number;
}

export interface TerminateAppResponse {
  device: DeviceInfo;
  appTerminated: boolean;
}

export interface RestartAppResponse {
  device: DeviceInfo;
  appRestarted: boolean;
  launchTimeMs: number;
}

export interface ResetAppDataResponse {
  device: DeviceInfo;
  dataCleared: boolean;
}

export interface GetLogsResponse {
  device: DeviceInfo;
  logs: string[];
  logCount: number;
}

export interface GetCrashResponse {
  device: DeviceInfo;
  crashes: string[];
}

export interface CaptureAndroidScreenResponse {
  device: DeviceInfo;
  screenshot: string; // base64 encoded string
  resolution: {
    width: number;
    height: number;
  };
}

export interface CaptureIOSScreenshotResponse {
  device: DeviceInfo;
  screenshot: string; // base64 encoded string
  resolution: {
    width: number;
    height: number;
  };
}
