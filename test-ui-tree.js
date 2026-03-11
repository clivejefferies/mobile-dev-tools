import { AndroidObserve } from "./src/android/observe.js";
const androidObserve = new AndroidObserve();
async function main() {
    console.log("Starting UI Tree Test...");
    try {
        const result = await androidObserve.getUITree();
        console.log("UI Tree Result:");
        // Print just the first few elements and metadata to avoid spamming the console
        const summary = {
            ...result,
            elements: result.elements.slice(0, 3) // First 3 elements
        };
        console.log(JSON.stringify(summary, null, 2));
        if (result.elements.length > 3) {
            console.log(`... and ${result.elements.length - 3} more elements.`);
        }
        if (result.error) {
            console.error("Test Failed with error:", result.error);
            process.exit(1);
        }
        if (result.elements.length === 0) {
            console.warn("Warning: No elements found. Is the screen empty or locked?");
        }
        else {
            console.log(`Successfully found ${result.elements.length} elements.`);
            // Check for new fields on the first element
            const first = result.elements[0];
            if (first.center && first.depth !== undefined) {
                console.log("✅ Verified 'center' and 'depth' fields exist.");
                console.log(`   Sample Center: [${first.center[0]}, ${first.center[1]}]`);
                console.log(`   Sample Depth: ${first.depth}`);
            }
            else {
                console.error("❌ 'center' or 'depth' fields missing!");
            }
            // Check filtering (heuristic: should not have many empty text/desc non-clickable items)
            const noisy = result.elements.filter(e => !e.clickable && !e.text && !e.contentDescription);
            if (noisy.length === 0) {
                console.log("✅ Filtering looks good (no obvious noise found).");
            }
            else {
                console.warn(`⚠️ Found ${noisy.length} potentially noisy elements.`);
            }
        }
    }
    catch (error) {
        console.error("Test Failed:", error);
    }
}
main();
