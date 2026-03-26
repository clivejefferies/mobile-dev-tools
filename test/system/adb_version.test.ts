import assert from 'assert'
import * as androidUtils from '../../src/utils/android/utils.js'
import * as systemStatus from '../../src/system/index.js'

const origEnsure = (androidUtils as any).ensureAdbAvailable

function mockEnsure(returnVal: any) {
  (androidUtils as any).ensureAdbAvailable = () => returnVal
}

function restoreEnsure() {
  (androidUtils as any).ensureAdbAvailable = origEnsure
}

describe('adb version parsing', () => {
  afterEach(() => {
    restoreEnsure()
  })

  it('uses only the first line of multi-line adb --version output', async () => {
    mockEnsure({ adbCmd: 'adb', ok: true, version: 'Android Debug Bridge version 1.0.41\nRevision 8f3b7' })
    const res = await systemStatus.getSystemStatus()
    assert.strictEqual(res.adbVersion, 'Android Debug Bridge version 1.0.41')
  })
})
