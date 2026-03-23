#!/usr/bin/env node
import { ToolsManage } from '../../../dist/manage/index.js'
import path from 'path'

async function main() {
  // Prefer a repo-local sample modul8 project if present, otherwise allow overriding via KMP_PROJECT env var
  const defaultRelative = path.join(process.cwd(), '..', '..', '..', '..', 'test-fixtures', 'modul8')
  const project = process.env.KMP_PROJECT || defaultRelative
  console.log('Running KMP build+install for project', project)
  // Use projectType=kmp and let handler pick android by default for KMP
  // Request iOS explicitly for this run to test iOS build path
  const res = await ToolsManage.buildAndInstallHandler({ platform: 'ios', projectPath: project, projectType: 'kmp', timeout: 600000, deviceId: undefined })
  console.log(JSON.stringify(res, null, 2))
  if (res.result && res.result.success) process.exit(0)
  process.exit(1)
}

main().catch(e => { console.error(e); process.exit(2) })