export type RunResult = {
  exitCode: number | null
  stdout: string
  stderr: string
  envSnapshot: Record<string,string | undefined>
  command: string
  args: string[]
  suggestedFixes?: string[]
}

export function makeEnvSnapshot(keys: string[]) {
  const snap: Record<string,string|undefined> = {}
  for (const k of keys) snap[k] = process.env[k]
  return snap
}

export function wrapExecResult(command: string, args: string[], res: { status: number | null, stdout?: string | Buffer, stderr?: string | Buffer }) : RunResult {
  return {
    exitCode: res.status,
    stdout: res.stdout ? (typeof res.stdout === 'string' ? res.stdout : res.stdout.toString()) : '',
    stderr: res.stderr ? (typeof res.stderr === 'string' ? res.stderr : res.stderr.toString()) : '',
    envSnapshot: makeEnvSnapshot(['PATH','IDB_PATH','JAVA_HOME','HOME']),
    command,
    args,
    suggestedFixes: []
  }
}

export class DiagnosticError extends Error {
  runResult: RunResult
  constructor(message: string, runResult: RunResult) {
    super(message)
    this.name = 'DiagnosticError'
    this.runResult = runResult
  }
}

// Exec ADB with diagnostics — moved from src/android/diagnostics.ts
import { spawnSync } from 'child_process'
import { getAdbCmd } from './android/utils.js'

export function execAdbWithDiagnostics(args: string[], deviceId?: string) {
  const adbArgs = deviceId ? ['-s', deviceId, ...args] : args
  const timeout = 120000
  const res = spawnSync(getAdbCmd(), adbArgs, { encoding: 'utf8', timeout })
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
