import { DeviceInfo } from "../types.js"
import { listAndroidDevices } from "./android/utils.js"
import { listIOSDevices } from "./ios/utils.js"

export interface ResolveOptions {
  platform: "android" | "ios"
  appId?: string
  prefer?: "physical" | "emulator"
  deviceId?: string
}

function parseNumericVersion(v: string): number {
  if (!v) return 0
  const m = v.match(/(\d+)(?:[\.\-](\d+))?/) 
  if (!m) return 0
  const major = parseInt(m[1], 10) || 0
  const minor = parseInt(m[2] || "0", 10) || 0
  return major + minor / 100
}

export async function listDevices(platform?: "android" | "ios", appId?: string): Promise<DeviceInfo[]> {
  if (!platform || platform === "android") {
    const android = await listAndroidDevices(appId)
    if (platform === "android") return android
    const ios = await listIOSDevices(appId)
    return [...android, ...ios]
  }
  return listIOSDevices(appId)
}

export async function resolveTargetDevice(opts: ResolveOptions): Promise<DeviceInfo> {
  const { platform, appId, prefer, deviceId } = opts
  const devices = await listDevices(platform, appId)

  if (deviceId) {
    const found = devices.find(d => d.id === deviceId)
    if (!found) throw new Error(`Device '${deviceId}' not found for platform ${platform}`)
    return found
  }

  let candidates = devices.slice()

  if (prefer === "physical") candidates = candidates.filter(d => !d.simulator)
  if (prefer === "emulator") candidates = candidates.filter(d => d.simulator)

  if (appId) {
    const installed = candidates.filter(d => (d as any).appInstalled)
    if (installed.length > 0) candidates = installed
  }

  if (candidates.length === 1) return candidates[0]

  if (candidates.length > 1) {
    if (!prefer) {
      const physical = candidates.filter(d => !d.simulator)
      if (physical.length === 1) return physical[0]
      if (physical.length > 1) candidates = physical
    }

    // Prefer booted iOS simulators if present
    if (platform === 'ios') {
      const booted = candidates.filter((d: any) => !!d.booted)
      if (booted.length === 1) return booted[0]
      if (booted.length > 1) return booted[0] // if multiple booted, pick the first
    }

    candidates.sort((a, b) => parseNumericVersion(b.osVersion) - parseNumericVersion(a.osVersion))
    if (candidates.length > 1 && parseNumericVersion(candidates[0].osVersion) > parseNumericVersion(candidates[1].osVersion)) {
      return candidates[0]
    }

    const list = candidates.map(d => ({ id: d.id, platform: d.platform, osVersion: d.osVersion, model: d.model, simulator: d.simulator, appInstalled: (d as any).appInstalled }))
    const err = new Error(`Multiple matching devices found: ${JSON.stringify(list, null, 2)}`)
    ;(err as any).devices = list
    throw err
  }

  throw new Error(`No devices found for platform ${platform}`)
}
