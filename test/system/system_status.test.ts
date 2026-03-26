import assert from 'assert'
import child_process from 'child_process'

import * as androidUtils from '../../src/utils/android/utils.js'
import * as iosUtils from '../../src/utils/ios/utils.js'
import * as systemStatus from '../../src/system/index.js'

const origExecSync = child_process.execSync
const origEnsure = (androidUtils as any).ensureAdbAvailable
const origGetXcrun = (iosUtils as any).getXcrunCmd

function mockExec(behaviour: (cmd: string) => string) {
  (child_process as any).execSync = (cmd: string) => {
    const s = typeof cmd === 'string' ? cmd : (Array.isArray(cmd) ? cmd.join(' ') : String(cmd))
    const out = behaviour(s)
    if (out instanceof Error) throw out
    return out
  }
}

function restoreExec() {
  (child_process as any).execSync = origExecSync
}

function mockEnsure(returnVal: any) {
  (androidUtils as any).ensureAdbAvailable = () => returnVal
}

function restoreEnsure() {
  (androidUtils as any).ensureAdbAvailable = origEnsure
}

function mockGetXcrun(val: string) {
  (iosUtils as any).getXcrunCmd = () => val
}

function restoreGetXcrun() {
  (iosUtils as any).getXcrunCmd = origGetXcrun
}

describe('system_status checks', () => {
  afterEach(() => {
    restoreExec(); restoreEnsure(); restoreGetXcrun()
  })

  it('reports healthy system when adb and xcrun present', async () => {
    mockEnsure({ adbCmd: 'adb', ok: true, version: '8.1.0' })
    mockGetXcrun('xcrun')

    mockExec((cmd) => {
      if (cmd.startsWith('adb devices')) return 'List of devices attached\nemulator-5554\tdevice'
      if (cmd.includes('adb logcat')) return 'I/Tag: ok'
      if (cmd.includes('adb shell pm path')) return 'package:/data/app/com.example-1/base.apk'
      if (cmd.startsWith('xcrun --version')) return 'xcrun version 123'
      if (cmd.includes('simctl list devices booted --json')) return JSON.stringify({ devices: {} })
      return ''
    })

    const res = await systemStatus.getSystemStatus()
    assert.strictEqual(res.success, true)
    assert.strictEqual(res.adbAvailable, true)
    assert.strictEqual(typeof res.adbVersion, 'string')
  })

  it('reports adb missing', async () => {
    mockEnsure({ adbCmd: 'adb', ok: false, error: 'not found' })
    mockGetXcrun('xcrun')
    mockExec((cmd) => {
      if (cmd.startsWith('xcrun --version')) return 'xcrun version'
      return ''
    })

    const res = await systemStatus.getSystemStatus()
    assert.strictEqual(res.success, false)
    assert(res.issues.some((i: string) => i.includes('ADB')))
  })

  it('detects unauthorized/offline devices', async () => {
    mockEnsure({ adbCmd: 'adb', ok: true, version: '8.1.0' })
    mockGetXcrun('xcrun')
    mockExec((cmd) => {
      if (cmd.startsWith('adb devices')) return 'List of devices attached\nserial1\tunauthorized\nserial2\toffline\n'
      if (cmd.startsWith('xcrun --version')) return 'xcrun version'
      return ''
    })

    const res = await systemStatus.getSystemStatus()
    assert.strictEqual(res.success, false)
    assert(res.issues.some((i: string) => i.includes('unauthorized')))
    assert(res.issues.some((i: string) => i.includes('offline')))
  })

  it('handles missing xcrun gracefully', async () => {
    mockEnsure({ adbCmd: 'adb', ok: true, version: '8.1.0' })
    mockGetXcrun('xcrun')
    mockExec((cmd) => {
      if (cmd.startsWith('adb devices')) return 'List of devices attached\nemulator-5554\tdevice'
      if (cmd.startsWith('xcrun --version')) throw new Error('not found')
      return ''
    })

    const res = await systemStatus.getSystemStatus()
    // Expect iOS check to be false and Android to be healthy
    assert.strictEqual(res.iosAvailable, false)
    assert.strictEqual(res.adbAvailable, true)
    // overall success may still be true (Android ok) but issues should include an xcrun-related message
    assert(res.issues.some((i: string) => i.toLowerCase().includes('xcrun') || i.toLowerCase().includes('ios')))
  })
})
