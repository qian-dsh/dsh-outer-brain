import fs from 'node:fs'
import { execSync } from 'node:child_process'

export function setDotted(obj, dotted, val) {
  const parts = String(dotted).split('.').filter(Boolean)
  if (!parts.length) return false
  let t = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (t == null || typeof t !== 'object') return false
    t = t[parts[i]]
  }
  if (t == null || typeof t !== 'object') return false
  t[parts[parts.length - 1]] = val
  return true
}

const runCmd = (cmd, cwd, timeoutMs) => {
  try {
    const out = execSync(cmd, { cwd, timeout: timeoutMs, stdio: 'pipe', shell: true })
    return { code: 0, out: String(out ?? ''), timedOut: false }
  } catch (e) {
    const timedOut = e?.signal === 'SIGTERM' || e?.killed === true || e?.code === 'ETIMEDOUT'
    return {
      code: typeof e?.status === 'number' ? e.status : 1,
      out: `${String(e?.stdout ?? '')}${String(e?.stderr ?? '')}`,
      timedOut,
    }
  }
}

export function runPair(o = {}) {
  const { cmd, cwd = process.cwd(), statePath, mutatePath, timeoutMs = 120000, expectExit = 0 } = o
  const claimPath = o.claimPath || mutatePath
  const sameField = String(mutatePath || '') === String(claimPath || '')
  const base = { normalExit: null, mutantExit: null, normalOut: '', mutantOut: '', restored: false, sameField }
  if (!cmd || !statePath || !mutatePath) {
    return { ...base, ok: false, why: 'runPair 缺参数（cmd / statePath / mutatePath）' }
  }
  if (!fs.existsSync(statePath)) {
    return { ...base, ok: false, why: `状态文件不存在：${statePath}` }
  }
  const raw = fs.readFileSync(statePath)
  const a = runCmd(cmd, cwd, timeoutMs)
  let mutantExit = null
  let mutantOut = ''
  let timedOut = Boolean(a.timedOut)
  let restored = false
  let why = ''
  try {
    const st = JSON.parse(raw.toString('utf8'))
    if (!setDotted(st, mutatePath, '')) {
      why = `改坏失败：路径 ${mutatePath} 不存在`
    } else {
      fs.writeFileSync(statePath, JSON.stringify(st, null, 2))
      const b = runCmd(cmd, cwd, timeoutMs)
      if (b.timedOut) {
        timedOut = true
        why = '改坏后超时 —— 超时不构成翻红（判据太慢，或改坏点让它卡死）'
      }
      mutantExit = b.code
      mutantOut = b.out
    }
  } finally {
    fs.writeFileSync(statePath, raw)
    restored = fs.readFileSync(statePath).equals(raw)
  }
  if (!restored) {
    return { ...base, normalExit: a.code, mutantExit, normalOut: a.out, mutantOut, ok: false, why: '还原失败：状态文件与备份不一致，立即人工检查' }
  }
  if (a.timedOut) why = why || '正常跑超时 —— 判据太慢，读数不可信'
  const want = Number.isInteger(expectExit) ? expectExit : 0
  const ok = a.code === want && mutantExit !== null && mutantExit !== want && sameField && !timedOut
  return {
    ok,
    normalExit: a.code,
    mutantExit,
    normalOut: a.out,
    mutantOut,
    restored,
    timedOut,
    sameField,
    why: ok ? '同址翻红成立' : (why || '条件不满足'),
  }
}
