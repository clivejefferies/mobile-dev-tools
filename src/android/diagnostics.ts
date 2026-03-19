import { spawnSync } from 'child_process'
import { getAdbCmd } from './utils.js'
import { RunResult, makeEnvSnapshot } from '../utils/diagnostics.js'

export function execAdbWithDiagnostics(args: string[], deviceId?: string) {
  const adbArgs = deviceId ? ['-s', deviceId, ...args] : args
  const timeout = 120000
  const res = spawnSync(getAdbCmd(), adbArgs, { encoding: 'utf8', timeout }) as any
  const runResult: RunResult = {
    exitCode: typeof res.status === 'number' ? res.status : null,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    envSnapshot: makeEnvSnapshot(['PATH','ADB_PATH','HOME','JAVA_HOME']),
    command: getAdbCmd(),
    args: adbArgs,
    suggestedFixes: []
  }
  if (res.status !== 0) {
    if ((runResult.stderr || '').includes('device not found')) runResult.suggestedFixes!.push('Ensure device is connected and adb is authorized (adb devices)')
    if ((runResult.stderr || '').includes('No such file or directory')) runResult.suggestedFixes!.push('Verify ADB_PATH or that adb is installed')
  }
  return { runResult }
}
