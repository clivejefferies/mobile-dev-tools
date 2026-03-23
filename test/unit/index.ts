// Aggregator entrypoint for unit tests (updated to new test layout)
import '../observe/unit/logparse.test.ts'
import '../observe/unit/logstream.test.ts'
import '../observe/unit/wait_for_element_mock.ts'
import '../observe/unit/get_screen_fingerprint.test.ts'

import '../manage/unit/install.test.ts'
import '../manage/unit/build.test.ts'
import '../manage/unit/build_and_install.test.ts'
import '../manage/unit/diagnostics.test.ts'
import '../manage/unit/detection.test.ts'
import '../manage/unit/mcp_disable_autodetect.test.ts'

console.log('Unit tests loaded.')
