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
  error?: string;
  diagnostics?: any;
}

export interface TerminateAppResponse {
  device: DeviceInfo;
  appTerminated: boolean;
  error?: string;
  diagnostics?: any;
}

export interface RestartAppResponse {
  device: DeviceInfo;
  appRestarted: boolean;
  launchTimeMs: number;
  error?: string;
  diagnostics?: any;
}

export interface ResetAppDataResponse {
  device: DeviceInfo;
  dataCleared: boolean;
  error?: string;
  diagnostics?: any;
}

export interface StructuredLogEntry {
  timestamp: string | null; // ISO string
  level: string; // VERBOSE, DEBUG, INFO, WARN, ERROR
  tag: string;
  pid: number | null;
  message: string;
}

export interface GetLogsResponse {
  device: DeviceInfo;
  logs: StructuredLogEntry[];
  logCount: number;
}

export interface GetCrashResponse {
  device: DeviceInfo;
  crashes: string[];
}

export interface CaptureAndroidScreenResponse {
  device: DeviceInfo;
  screenshot: string; // base64 encoded string
  screenshot_mime?: string; // e.g. image/webp, image/jpeg, image/png
  screenshot_fallback?: string; // optional fallback base64 (e.g., jpeg)
  screenshot_fallback_mime?: string;
  resolution: {
    width: number;
    height: number;
  };
}

export interface CaptureIOSScreenshotResponse {
  device: DeviceInfo;
  screenshot: string; // base64 encoded string
  screenshot_mime?: string; // e.g. image/webp, image/jpeg, image/png
  screenshot_fallback?: string; // optional fallback base64 (e.g., jpeg)
  screenshot_fallback_mime?: string;
  resolution: {
    width: number;
    height: number;
  };
}

export interface UIElement {
  text: string | null;
  contentDescription: string | null;
  type: string;
  clickable: boolean;
  enabled: boolean;
  visible: boolean;
  bounds: [number, number, number, number];
  resourceId: string | null;
  parentId?: number;
  children?: number[];
  center?: [number, number];
  depth?: number;
}

export interface GetUITreeResponse {
  device: DeviceInfo;
  screen: string;
  resolution: {
    width: number;
    height: number;
  };
  elements: UIElement[];
  error?: string;
}

export interface GetCurrentScreenResponse {
  device: DeviceInfo;
  package: string;
  activity: string;
  shortActivity: string;
  error?: string;
}

export interface WaitForElementResponse {
  device: DeviceInfo;
  found: boolean;
  element?: UIElement;
  error?: string;
}

export interface TapResponse {
  device: DeviceInfo;
  success: boolean;
  x: number;
  y: number;
  error?: string;
}

export interface SwipeResponse {
  device: DeviceInfo;
  success: boolean;
  start: [number, number];
  end: [number, number];
  duration: number;
  error?: string;
}

export interface TypeTextResponse {
  device: DeviceInfo;
  success: boolean;
  text: string;
  error?: string;
}

export interface PressBackResponse {
  device: DeviceInfo;
  success: boolean;
  error?: string;
}

export interface InstallAppResponse {
  device: DeviceInfo;
  installed: boolean;
  output?: string;
  error?: string;
  diagnostics?: any;
}

