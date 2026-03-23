import { parseLogLine } from '../../../src/utils/android/utils.js'

function assert(cond: boolean, msg?: string) { if (!cond) throw new Error(msg || 'Assertion failed') }

function run() {
  const samples = [
    // Standard format
    {
      line: '03-13 15:08:25.257  2468  2578 E FromGoneTransitionInteractor: Ignoring startTransition: ...',
      expect: { level: 'E', tag: 'FromGoneTransitionInteractor', crash: false }
    },
    // Full date format
    {
      line: '2026-03-13 15:08:25.257  2468  2578 E Something: Boom happened',
      expect: { level: 'E', tag: 'Something', crash: false }
    },
    // Simple priority/tag
    {
      line: 'W/MyTag: Some warning here',
      expect: { level: 'W', tag: 'MyTag', crash: false }
    },
    // Crash message
    {
      line: '03-13 15:09:01.123  9999  9999 E AndroidRuntime: FATAL EXCEPTION: main\njava.lang.NullPointerException: at ...',
      expect: { level: 'E', tag: 'AndroidRuntime', crash: true, exceptionContains: 'NullPointerException' }
    }
  ]

  for (const s of samples) {
    const res = parseLogLine(s.line)
    console.log('Parsed:', res)
    assert(res.level === s.expect.level, `Expected level ${s.expect.level} got ${res.level}`)
    assert(res.tag === s.expect.tag, `Expected tag ${s.expect.tag} got ${res.tag}`)
    if (s.expect.crash) assert(res.crash === true, 'Expected crash true')
    if (s.expect.exceptionContains) assert(res.exception && res.exception.indexOf(s.expect.exceptionContains) !== -1, 'Expected exception to contain ' + s.expect.exceptionContains)
  }

  console.log('Log parse tests passed')
}

run()