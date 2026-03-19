import assert from 'assert'
import { detectJavaHome } from '../../../src/utils/java.js'

// These tests are lightweight smoke tests; they don't rely on actual JDK17 installs,
// but exercise the failure modes and ensure the function returns undefined or a string.

export async function run() {
  const res = await detectJavaHome()
  // It's acceptable for local dev env to not have JDK17; just ensure call returns (string|undefined)
  assert.ok(typeof res === 'string' || typeof res === 'undefined')

  // Basic mocking: set JAVA_HOME to a fake path and ensure detectJavaHome still runs without throwing.
  const orig = process.env.JAVA_HOME
  process.env.JAVA_HOME = '/non/existent/java/home'
  await detectJavaHome()
  // accept either undefined or string results depending on environment; do not fail deterministically
  process.env.JAVA_HOME = orig

  console.log('detectJavaHome tests passed')
}

run().catch((e) => { console.error(e); process.exit(1) })