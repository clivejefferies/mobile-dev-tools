import { AndroidObserve, iOSObserve } from "../../src/observe/index.js";
import { AndroidInteract } from "../../src/interact/index.js";
import { iOSInteract } from "../../src/interact/index.js";
import fs from "fs/promises";

const androidObserve = new AndroidObserve();
const androidInteract = new AndroidInteract();
const iosObserve = new iOSObserve();
const iosInteract = new iOSInteract();

async function main() {
  const args = process.argv.slice(2);
  const platform = args[0] as string;
  const appId = args[1];

  if ((platform !== "android" && platform !== "ios") || !appId) {
    console.error("Usage: npx tsx test/smoke-test.ts <android|ios> <appId>");
    process.exit(1);
  }

  console.log(`\n🚀 Starting smoke test for ${platform} app: ${appId}`);

  try {
    console.log(`[1/4] Starting app...`);
    let startResult: boolean;
    let launchTimeMs: number;

    if (platform === "android") {
      const result = await androidInteract.startApp(appId);
      startResult = result.appStarted;
      launchTimeMs = result.launchTimeMs;
    } else {
      const result = await iosInteract.startApp(appId);
      startResult = result.appStarted;
      launchTimeMs = result.launchTimeMs;
    }

    if (startResult) {
      console.log(`✅ App started successfully (Launch time: ${launchTimeMs}ms)`);
    } else {
      throw new Error("Failed to start app");
    }

    console.log(`⏳ Waiting 3s for app to load...`);
    await new Promise(r => setTimeout(r, 3000));

    console.log(`[2/4] Capturing screenshot...`);
    let screenshotBase64: string;
    let resolution: { width: number; height: number };

    if (platform === "android") {
      const result = await androidObserve.captureScreen();
      screenshotBase64 = result.screenshot;
      resolution = result.resolution;
    } else {
      const result = await iosObserve.captureScreenshot();
      screenshotBase64 = result.screenshot;
      resolution = result.resolution;
    }

    if (screenshotBase64) {
      const fileName = `smoke-test-${platform}.png`;
      await fs.writeFile(fileName, Buffer.from(screenshotBase64, 'base64'));
      console.log(`✅ Screenshot saved to ./${fileName} (${resolution.width}x${resolution.height})`);
    } else {
      throw new Error("Failed to capture screenshot");
    }

    console.log(`[3/4] Fetching logs...`);
    let logsCount = 0;
    let logs: string[] = [];

    if (platform === "android") {
      const result = await androidObserve.getLogs(appId, 50);
      logsCount = result.logCount;
      logs = result.logs;
    } else {
      const result = await iosObserve.getLogs(appId);
      logsCount = result.logCount;
      logs = result.logs;
    }

    console.log(`✅ Retrieved ${logsCount} log lines`);
    if (logs.length > 0) {
      console.log(`   Sample: "${logs[logs.length - 1].substring(0, 80)}..."`);
    }

    console.log(`[4/4] Terminating app...`);
    let termResult: boolean;

    if (platform === "android") {
      const result = await androidInteract.terminateApp(appId);
      termResult = result.appTerminated;
    } else {
      const result = await iosInteract.terminateApp(appId);
      termResult = result.appTerminated;
    }

    if (termResult) {
      console.log(`✅ App terminated successfully`);
    } else {
      throw new Error("Failed to terminate app");
    }

    console.log(`\n✨ Smoke test COMPLETED SUCCESSFULLY! ✨\n`);

  } catch {
    console.error(`\n❌ Smoke test FAILED:`, error);
    process.exit(1);
  }
}

main();
