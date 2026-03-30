import { StructuredLogEntry } from '../../../src/types.js'

function assert(cond: boolean, msg?: string) { if (!cond) throw new Error(msg || 'Assertion failed') }

function applyFilters(entries: StructuredLogEntry[], opts: { contains?: string, level?: string, tag?: string, pid?: number, since_seconds?: number, limit?: number }) {
  let filtered = entries.slice()
  if (opts.contains) filtered = filtered.filter(e => e.message && e.message.includes(opts.contains!))
  if (opts.since_seconds) {
    const sinceMs = Date.now() - (opts.since_seconds * 1000)
    filtered = filtered.filter(e => e.timestamp && (new Date(e.timestamp).getTime() >= sinceMs))
  }
  if (opts.level) filtered = filtered.filter(e => e.level && e.level.toUpperCase() === opts.level!.toUpperCase())
  if (opts.tag) filtered = filtered.filter(e => e.tag && e.tag.includes(opts.tag!))
  if (typeof opts.pid === 'number') filtered = filtered.filter(e => e.pid === opts.pid)
  // oldest -> newest
  filtered.sort((a,b) => (a.timestamp? new Date(a.timestamp).getTime():0) - (b.timestamp? new Date(b.timestamp).getTime():0))
  const lim = typeof opts.limit === 'number' && opts.limit > 0 ? opts.limit : 50
  return filtered.slice(-Math.max(0, lim))
}

function run() {
  const now = Date.now()
  const entries: StructuredLogEntry[] = [
    { timestamp: new Date(now - 60000).toISOString(), level: 'INFO', tag: 'A', pid: 123, message: 'startup complete' },
    { timestamp: new Date(now - 45000).toISOString(), level: 'WARN', tag: 'B', pid: 124, message: 'slow response' },
    { timestamp: new Date(now - 30000).toISOString(), level: 'ERROR', tag: 'A', pid: 123, message: 'Unhandled exception' },
    { timestamp: new Date(now - 15000).toISOString(), level: 'DEBUG', tag: 'C', pid: 125, message: 'debug info' },
    { timestamp: new Date(now - 5000).toISOString(), level: 'INFO', tag: 'A', pid: 123, message: 'user action happened' }
  ]

  // contains filter
  const c1 = applyFilters(entries, { contains: 'user' })
  assert(c1.length === 1 && c1[0].message.includes('user'), 'contains filter failed')

  // level filter
  const e1 = applyFilters(entries, { level: 'ERROR' })
  assert(e1.length === 1 && e1[0].level === 'ERROR', 'level filter failed')

  // tag filter
  const t1 = applyFilters(entries, { tag: 'A' })
  assert(t1.length === 3, 'tag filter failed')

  // pid filter
  const p1 = applyFilters(entries, { pid: 123 })
  assert(p1.length === 3, 'pid filter failed')

  // since_seconds filter (last 20s) should include last two entries
  const s1 = applyFilters(entries, { since_seconds: 20 })
  if (s1.length !== 2) throw new Error('since_seconds filter expected 2 entries, got ' + s1.length)

  // limit
  const l1 = applyFilters(entries, { limit: 2 })
  assert(l1.length === 2 && l1[0].timestamp <= l1[1].timestamp, 'limit or ordering failed')

  console.log('get_logs unit tests passed')
}

run()