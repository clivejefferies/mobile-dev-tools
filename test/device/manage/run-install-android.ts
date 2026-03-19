#!/usr/bin/env node
import { AndroidManage } from '../../../dist/android/manage.js'

async function main() {
  const [, , appPath, deviceId] = process.argv
  if (!appPath) {
    console.error('Usage: node test/integration/run-install-android.ts <apk-or-project-dir> [deviceId]')
    process.exit(1)
  }

  const mgr = new AndroidManage()
  try {
    const res = await mgr.installApp(appPath, deviceId)
    console.log(JSON.stringify(res, null, 2))
  } catch (err:any) {
    console.error('Install failed:', err instanceof Error ? err.message : String(err))
    process.exit(2)
  }
}

main()
