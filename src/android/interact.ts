import { StartAppResponse, TerminateAppResponse, RestartAppResponse, ResetAppDataResponse } from "../types.js"
import { execAdb, getAndroidDeviceMetadata, getDeviceInfo } from "./utils.js"

export class AndroidInteract {
  async startApp(appId: string, deviceId?: string): Promise<StartAppResponse> {
    const metadata = await getAndroidDeviceMetadata(appId, deviceId)
    const deviceInfo = getDeviceInfo(deviceId || 'default', metadata)
    
    await execAdb(['shell', 'monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1'], deviceId)
    
    return { device: deviceInfo, appStarted: true, launchTimeMs: 1000 }
  }

  async terminateApp(appId: string, deviceId?: string): Promise<TerminateAppResponse> {
    const metadata = await getAndroidDeviceMetadata(appId, deviceId)
    const deviceInfo = getDeviceInfo(deviceId || 'default', metadata)

    await execAdb(['shell', 'am', 'force-stop', appId], deviceId)
    
    return { device: deviceInfo, appTerminated: true }
  }

  async restartApp(appId: string, deviceId?: string): Promise<RestartAppResponse> {
    await this.terminateApp(appId, deviceId)
    const startResult = await this.startApp(appId, deviceId)
    return {
      device: startResult.device,
      appRestarted: startResult.appStarted,
      launchTimeMs: startResult.launchTimeMs
    }
  }

  async resetAppData(appId: string, deviceId?: string): Promise<ResetAppDataResponse> {
    const metadata = await getAndroidDeviceMetadata(appId, deviceId)
    const deviceInfo = getDeviceInfo(deviceId || 'default', metadata)

    const output = await execAdb(['shell', 'pm', 'clear', appId], deviceId)
    
    return { device: deviceInfo, dataCleared: output === 'Success' }
  }
}
