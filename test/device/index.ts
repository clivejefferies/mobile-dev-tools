#!/usr/bin/env node
// Device tests runner
// This runner loads minimal utilities, and only imports the device tests when
// RUN_DEVICE_TESTS=true to avoid running them in CI by default.

import './utils/test-dist';

(async () => {
  if (process.env.RUN_DEVICE_TESTS === 'true') {
    console.log('RUN_DEVICE_TESTS=true: running device integration tests');
    await Promise.all([
      import('./manage/install.integration'),
      import('./manage/run-install-android'),
      import('./manage/run-install-ios'),
      import('./observe/logstream-real'),
      import('./observe/test-ui-tree'),
      import('./observe/wait_for_element_real'),
      import('./interact/run-real-test'),
      import('./interact/smoke-test')
    ]);
    console.log('Device integration imports complete');
  } else {
    console.log('Skipping device-dependent integration tests. Set RUN_DEVICE_TESTS=true to enable them.');
  }
})();

console.log('Device tests runner ready');