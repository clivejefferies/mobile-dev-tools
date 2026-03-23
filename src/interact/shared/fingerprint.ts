import crypto from 'crypto'
import { GetUITreeResponse, GetCurrentScreenResponse, UIElement } from '../../types.js'

const ANDROID_STRUCTURAL_TYPES = ['Window','Application','View','ViewGroup','LinearLayout','FrameLayout','RelativeLayout','ScrollView','RecyclerView','TextView','ImageView']
const IOS_STRUCTURAL_TYPES = ['Window','Application','View','ViewController','UITableView','UICollectionView','UILabel','UIImageView','UIView','UIWindow','UIStackView','UITextView','UITableViewCell']

function isDynamicText(t?: string): boolean {
  if (!t) return false
  const txt = t.trim()
  if (!txt) return false
  if (/\b\d{1,2}:\d{2}\b/.test(txt)) return true
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(txt)) return true
  if (/^\d+(?:\.\d+)?%$/.test(txt)) return true
  if (/^\d+$/.test(txt)) return true
  if (/^[\d,]{1,10}$/.test(txt)) return true
  return false
}

function normalizeElement(e: UIElement) {
  return {
    type: (e.type || '').toString(),
    resourceId: (e.resourceId || '').toString(),
    text: typeof e.text === 'string' ? (isDynamicText(e.text) ? '' : e.text.trim().toLowerCase()) : '',
    contentDesc: (e.contentDescription || '').toString(),
    bounds: Array.isArray(e.bounds) ? e.bounds.slice(0,4).map((n:any)=>Number(n)||0) : [0,0,0,0]
  }
}

export function computeScreenFingerprint(tree: GetUITreeResponse, current: GetCurrentScreenResponse | null, platform: 'android' | 'ios', limit: number = 50): { fingerprint: string | null; activity?: string; error?: string } {
  try {
    if (!tree || (tree as any).error) return { fingerprint: null, error: (tree as any).error }

    const activity = current && (current.activity || (current as any).shortActivity) ? (current.activity || (current as any).shortActivity) : ''

    const candidates: UIElement[] = (tree.elements || []).filter(e => {
      if (!e) return false
      if (!e.visible) return false
      const hasStableText = typeof e.text === 'string' && e.text.trim().length > 0
      const hasResource = !!e.resourceId
      const interactable = !!e.clickable || !!e.enabled
      const structuralList = platform === 'android' ? ANDROID_STRUCTURAL_TYPES : IOS_STRUCTURAL_TYPES
      const structurallySignificant = hasStableText || hasResource || structuralList.includes(e.type || '')
      return interactable || structurallySignificant
    }) as UIElement[]

    const normalized = candidates.map(normalizeElement)

    const filteredNormalized = normalized.filter(e => (e.text && e.text.length > 0) || (e.resourceId && e.resourceId.length > 0) || (e.contentDesc && e.contentDesc.length > 0))

    filteredNormalized.sort((a,b) => {
      const ay = (a.bounds && a.bounds[1]) || 0
      const by = (b.bounds && b.bounds[1]) || 0
      if (ay !== by) return ay - by
      const ax = (a.bounds && a.bounds[0]) || 0
      const bx = (b.bounds && b.bounds[0]) || 0
      return ax - bx
    })

    const limited = filteredNormalized.slice(0, Math.max(0, limit))

    const payload = {
      activity: platform === 'android' ? (activity || '') : '',
      resolution: (tree as any).resolution || { width: 0, height: 0 },
      elements: limited.map(e => ({ type: e.type, resourceId: e.resourceId, text: e.text, contentDesc: e.contentDesc }))
    }

    const combined = JSON.stringify(payload)
    const hash = crypto.createHash('sha256').update(combined).digest('hex')
    return { fingerprint: hash, activity: activity }
  } catch (e) {
    return { fingerprint: null, error: e instanceof Error ? e.message : String(e) }
  }
}
