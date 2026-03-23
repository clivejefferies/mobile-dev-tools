import { AndroidObserve } from '../../../src/observe/index.js'

async function run() {
  console.log('Starting get_screen_fingerprint unit tests...')

  const origGet = (AndroidObserve as any).prototype.getUITree
  const origCurrent = (AndroidObserve as any).prototype.getCurrentScreen

  // Test 1: stable identical screens produce same fingerprint
  ;(AndroidObserve as any).prototype.getUITree = async function() {
    return {
      device: { platform: 'android', id: 'mock', osVersion: '12', model: 'Pixel', simulator: true },
      screen: '',
      resolution: { width: 1080, height: 1920 },
      elements: [
        { text: 'Title', type: 'TextView', contentDescription: null, clickable: false, enabled: true, visible: true, bounds: [0,0,1080,100], resourceId: 'id/title' },
        { text: 'Sign in', type: 'Button', contentDescription: null, clickable: true, enabled: true, visible: true, bounds: [0,200,200,260], resourceId: 'id/signin' }
      ]
    }
  }

  ;(AndroidObserve as any).prototype.getCurrentScreen = async function() {
    return { device: { platform: 'android', id: 'mock', osVersion: '12', model: 'Pixel', simulator: true }, package: 'com.example', activity: 'com.example.MainActivity', shortActivity: 'MainActivity' }
  }

  const ai = new AndroidObserve()
  const a = await ai.getScreenFingerprint('mock')
  const b = await ai.getScreenFingerprint('mock')
  console.log('Test 1:', a.fingerprint === b.fingerprint ? 'PASS' : 'FAIL')

  // Test 2: change in UI text changes fingerprint
  ;(AndroidObserve as any).prototype.getUITree = async function() {
    return {
      device: { platform: 'android', id: 'mock', osVersion: '12', model: 'Pixel', simulator: true },
      screen: '',
      resolution: { width: 1080, height: 1920 },
      elements: [
        { text: 'Title', type: 'TextView', contentDescription: null, clickable: false, enabled: true, visible: true, bounds: [0,0,1080,100], resourceId: 'id/title' },
        { text: 'Profile', type: 'Button', contentDescription: null, clickable: true, enabled: true, visible: true, bounds: [0,200,200,260], resourceId: 'id/signin' }
      ]
    }
  }

  const c = await ai.getScreenFingerprint('mock')
  console.log('Test 2:', a.fingerprint !== c.fingerprint ? 'PASS' : 'FAIL')

  // Test 3: dynamic text ignored (timestamp) should not change fingerprint
  ;(AndroidObserve as any).prototype.getUITree = async function() {
    return {
      device: { platform: 'android', id: 'mock', osVersion: '12', model: 'Pixel', simulator: true },
      screen: '',
      resolution: { width: 1080, height: 1920 },
      elements: [
        { text: 'Title', type: 'TextView', contentDescription: null, clickable: false, enabled: true, visible: true, bounds: [0,0,1080,100], resourceId: 'id/title' },
        { text: 'Sign in', type: 'Button', contentDescription: null, clickable: true, enabled: true, visible: true, bounds: [0,200,200,260], resourceId: 'id/signin' },
        { text: '12:34', type: 'TextView', contentDescription: null, clickable: false, enabled: true, visible: true, bounds: [900,10,1080,40], resourceId: null }
      ]
    }
  }

  const d = await ai.getScreenFingerprint('mock')
  console.log('Test 3:', a.fingerprint === d.fingerprint ? 'PASS' : 'FAIL')

  // Restore
  ;(AndroidObserve as any).prototype.getUITree = origGet
  ;(AndroidObserve as any).prototype.getCurrentScreen = origCurrent
}

run().catch(console.error)
