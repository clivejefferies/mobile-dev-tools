import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADB_PATH = process.env.ADB_PATH || process.env.ADB || 'adb';
const TEST_FILE = path.join(__dirname, 'wait_for_element_real.ts');

const childEnv = { ...process.env, ADB_PATH };
const runner = process.env.RUNNER || 'npx';
const runnerArgs = ['tsx', TEST_FILE];

const child = spawn(runner, runnerArgs, {
  env: childEnv,
  stdio: 'inherit'
});
child.on('exit', (code) => {
  process.exit(code || 0);
});
