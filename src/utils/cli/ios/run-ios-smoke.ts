import { iOSObserve } from '../../../observe/index.js';
import { iOSManage } from '../../../manage/index.js';

async function main() {
  const appId = process.argv[2] || 'com.apple.springboard';
  const deviceId = 'booted';
  const obs = new iOSObserve();
  const manage = new iOSManage();

  try {
    console.log('[1] startApp ->', appId)
    const start = await manage.startApp(appId, deviceId);
    console.log('start result:', start)

    console.log('[2] captureScreenshot')
    const shot = await obs.captureScreenshot(deviceId);
    console.log('screenshot OK? size:', shot && shot.screenshot ? shot.screenshot.length : 0)

    console.log('[3] getLogs')
    const logs = await obs.getLogs(appId, undefined);
    console.log('logs count:', logs.logCount)

    console.log('[4] terminateApp')
    const term = await manage.terminateApp(appId, deviceId);
    console.log('terminate:', term)

    console.log('SMOKE OK')
  } catch (err) {
    console.error('SMOKE ERROR:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

main();
