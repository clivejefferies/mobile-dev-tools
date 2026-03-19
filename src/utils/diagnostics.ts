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
