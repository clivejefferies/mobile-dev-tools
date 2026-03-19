/**
 * Test script for verify UI Tree functionality.
 * 
 * Usage:
 *   npx tsx test-ui-tree.ts [android|ios] [deviceId]
 * 
 * Examples:
 *   npx tsx test-ui-tree.ts android
 *   npx tsx test-ui-tree.ts ios booted
 */

import { AndroidObserve } from '../../src/android/observe.js';
import { iOSObserve } from '../../src/ios/observe.js';

async function main() {
  const args = process.argv.slice(2);
  const platform = (args[0] || 'android').toLowerCase();
  const deviceId = args[1];

  console.log(`Starting UI Tree Test for ${platform}...`);
  if (deviceId) console.log(`Targeting device: ${deviceId}`);

  try {
    let result;
    
    if (platform === 'ios') {
        const observer = new iOSObserve();
        result = await observer.getUITree(deviceId || 'booted');
    } else {
        const observer = new AndroidObserve();
        result = await observer.getUITree(deviceId);
    }

    console.log("\nUI Tree Result Summary:");
    console.log("-----------------------");
    
    if (result.error) {
        console.error("❌ Error:", result.error);
        process.exit(1);
    }

    console.log(`Device: ${result.device.platform} (${result.device.model || 'Unknown Model'})`);
    console.log(`Resolution: ${result.resolution.width}x${result.resolution.height}`);
    console.log(`Elements Found: ${result.elements.length}`);

    if (result.elements.length === 0) {
        console.warn("⚠️ Warning: No elements found. Is the screen empty or locked?");
    } else {
        // Print sample element to verify structure
        const first = result.elements[0];
        console.log("\nSample Element (First):");
        console.log(JSON.stringify(first, null, 2));

        // Check for new fields
        if (first.center && first.depth !== undefined) {
             console.log("\n✅ Verified 'center' and 'depth' fields exist.");
        } else {
             console.error("\n❌ 'center' or 'depth' fields missing!");
             process.exit(1);
        }
        
        // Check for filtering
        const interactive = result.elements.filter(e => e.clickable).length;
        const withText = result.elements.filter(e => e.text).length;
        console.log(`\nStats:`);
        console.log(`- Interactive elements: ${interactive}`);
        console.log(`- Elements with text: ${withText}`);
    }

  } catch {
    console.error("\n❌ Test Failed:", error);
    process.exit(1);
  }
}

main();
