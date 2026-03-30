import fs from 'fs'
import { execSync } from 'child_process'

function log(msg: string) { console.log(msg) }

if (process.env.SKIP_DEVICE_TESTS === '1') {
  log('SKIP_DEVICE_TESTS=1 detected - skipping android device smoke test')
  process.exit(0)
}

// Ensure helper script exists
const helperScript = 'test/helpers/run-get-logs.ts'
if (!fs.existsSync(helperScript)) {
  console.error(`Missing ${helperScript}. Run 'npm run build' first or ensure the helper exists.`)
  process.exit(1)
}

try {
  // Run the helper smoke script for android
  const cmd = `tsx ${helperScript} --platform android --id default --limit 20`
  const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 30000 })
  const parsed = JSON.parse(out)

  if (!parsed || !Array.isArray(parsed.logs)) throw new Error('Output missing logs array')
  const count = parsed.count ?? parsed.logs.length
  if (count !== parsed.logs.length) throw new Error('count mismatch')
  if (parsed.logs.some((e: any) => !e.timestamp || !e.level || typeof e.message !== 'string')) throw new Error('log entry missing fields')

  log('Android device smoke test: PASS')
  process.exit(0)
} catch (err: any) {
  console.error('Android device smoke test: FAIL')
  console.error(err && err.message ? err.message : err)
  process.exit(2)
}
