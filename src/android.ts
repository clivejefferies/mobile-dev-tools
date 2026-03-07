import { exec } from "child_process"

const ADB = process.env.ADB_PATH || "adb"

export function startAndroidApp(pkg: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(
      `${ADB} shell monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`,
      (err, stdout, stderr) => {
        if (err) reject(stderr)
        else resolve(stdout)
      }
    )
  })
}

export function getAndroidLogs(pkg: string, lines = 200): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(`${ADB} shell pidof -s ${pkg}`, (pidErr, pidStdout, pidStderr) => {
      if (pidErr || !pidStdout.trim()) {
        reject(pidStderr || "App process not running")
        return
      }

      const pid = pidStdout.trim()

      exec(`${ADB} logcat -d --pid=${pid} -t ${lines} -v threadtime`, (err, stdout, stderr) => {
        if (err) reject(stderr || err.message)
        else resolve(stdout)
      })
    })
  })
}

export async function getAndroidCrash(pkg: string, lines = 200): Promise<string> {
  try {
    const logs = await getAndroidLogs(pkg, lines)
    const crashLines = logs
      .split('\n')
      .filter(line => line.includes('FATAL EXCEPTION'))
    if (crashLines.length === 0) {
      return "No crashes found."
    }
    return crashLines.join('\n')
  } catch (error) {
    return `Error retrieving crash logs: ${error}`
  }
}