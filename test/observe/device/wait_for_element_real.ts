import { AndroidInteract } from "../../src/interact/index.js";
import { AndroidObserve } from "../../src/observe/index.js";

// Usage: npx tsx test/wait_for_element_real.ts <deviceId> <appId>
const args = process.argv.slice(2);
const DEVICE_ID = args[0] || process.env.DEVICE_ID;
const APP_ID = args[1] || process.env.APP_ID;

if (!DEVICE_ID || !APP_ID) {
  console.error("Usage: npx tsx test/wait_for_element_real.ts <deviceId> <appId> or set DEVICE_ID and APP_ID env vars");
  process.exit(1);
}

async function runRealTest() {
  console.log(`Connecting to device ${DEVICE_ID}...`);
  const interact = new AndroidInteract();
  const observe = new AndroidObserve();
  try {
    console.log(`\nStarting app ${APP_ID}...`);
    await interact.startApp(APP_ID, DEVICE_ID);
    console.log("Waiting 3s for app to render...");
    await new Promise(r => setTimeout(r, 3000));

    console.log("\nFetching UI Tree to find a target text...");
    const tree = await observe.getUITree(DEVICE_ID);
    if (tree.error) {
      console.error("Failed to get UI Tree:", tree.error);
      return;
    }

    const targetElement = tree.elements.find(e => e.text && e.text.length > 0 && e.visible);
    if (!targetElement || !targetElement.text) {
      console.warn("No visible text elements found on screen to test with.");
      console.log("Elements found:", tree.elements.length);
      return;
    }

    const targetText = targetElement.text;
    console.log(`Found target element: "${targetText}"`);

    console.log(`\nTest 1: Waiting for existing element "${targetText}" (should succeed)...`);
    const start1 = Date.now();
    const result1 = await interact.waitForElement(targetText, 5000, DEVICE_ID);
    const elapsed1 = Date.now() - start1;
    console.log(`Result: ${result1.found ? "PASS" : "FAIL"}`);
    console.log(`Found Element: ${result1.element?.text}`);
    console.log(`Time taken: ${elapsed1}ms`);

    const missingText = "THIS_TEXT_SHOULD_NOT_EXIST_XYZ_123";
    console.log(`\nTest 2: Waiting for missing element "${missingText}" (should timeout)...`);
    const start2 = Date.now();
    const result2 = await interact.waitForElement(missingText, 2000, DEVICE_ID);
    const elapsed2 = Date.now() - start2;
    console.log(`Result: ${!result2.found ? "PASS" : "FAIL"}`);
    console.log(`Found: ${result2.found}`);
    console.log(`Time taken: ${elapsed2}ms (expected ~2000ms)`);

    console.log(`\nTest 3: Found after polling`);
    let calls = 0;
    AndroidObserve.prototype.getUITree = async function() {
      calls++;
      if (calls < 3) {
        return { device: { platform: "android", id: "mock", osVersion: "12", model: "Pixel", simulator: true }, screen: "", resolution: { width: 1080, height: 1920 }, elements: [] };
      }
      return { device: { platform: "android", id: "mock", osVersion: "12", model: "Pixel", simulator: true }, screen: "", resolution: { width: 1080, height: 1920 }, elements: [{ text: "Target", type: "Button", contentDescription: null, clickable: true, enabled: true, visible: true, bounds: [0,0,100,100], resourceId: null }] };
    } as any;

    const start3 = Date.now();
    const result3 = await interact.waitForElement("Target", 2000, DEVICE_ID);
    const elapsed3 = Date.now() - start3;
    console.log(`Result: ${result3.found ? "PASS" : "FAIL"}`);
    console.log(`Calls: ${calls} ${calls === 3 ? "PASS" : "FAIL"}`);
    console.log(`Elapsed time (should be >= 1000ms): ${elapsed3} ${elapsed3 >= 1000 ? "PASS" : "FAIL"}`);

  } catch {
    console.error("Test failed with error:", error);
  }
}

runRealTest();
