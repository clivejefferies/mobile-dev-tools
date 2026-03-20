import { iOSObserve } from '../../ios/observe.js';
import { iOSInteract } from '../../ios/interact.js';

async function main() {
  const deviceId = 'booted';
  const obs = new iOSObserve();
  const interact = new iOSInteract();

  console.log('Fetching UI tree...');
  const tree = await obs.getUITree(deviceId as any);
  if (tree.error) {
    console.error('getUITree error:', tree.error);
    process.exit(2);
  }
  console.log('Elements found:', tree.elements.length);
  if (!tree.elements || tree.elements.length === 0) {
    console.error('No elements found; aborting');
    process.exit(3);
  }

  const clickable = tree.elements.find(e => e.clickable) || tree.elements[0];
  console.log('Using element:', clickable.text || '(no text)', 'clickable=', clickable.clickable, 'center=', clickable.center);
  const [x,y] = clickable.center || [0,0];

  console.log(`Tapping at ${x},${y}...`);
  const res = await interact.tap(x, y, deviceId as any);
  console.log('Tap result:', res);

  if (res.success) process.exit(0);
  else process.exit(4);
}

main();
