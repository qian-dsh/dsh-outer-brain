import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_FILE = 'TOUCHES.json'

const uniq = (a) => [...new Set((Array.isArray(a) ? a : []).map(String).filter(Boolean))]
const load = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return {} }
}
const save = (file, obj) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(obj, null, 2))
}

export function noteTouch(objKey, info = {}, opts = {}) {
  const file = opts.file || path.join(opts.root || process.cwd(), DEFAULT_FILE)
  const db = load(file)
  const k = String(objKey || '').trim()
  if (!k) throw new Error('noteTouch 需要对象名')
  const at = new Date().toISOString()
  const prev = db[k] || { file: '', deps: [], usedBy: [], points: [], scope: 'local', why: '', at: '', n: 0, history: [] }
  const merged = {
    file: info.file || prev.file,
    deps: uniq([...(prev.deps || []), ...(info.deps || [])]),
    usedBy: uniq([...(prev.usedBy || []), ...(info.usedBy || [])]),
    points: uniq([...(prev.points || []), ...(info.points || [])]),
    scope: info.scope || prev.scope || 'local',
    why: info.why || prev.why || '',
    at,
    n: (Number(prev.n) || 0) + 1,
    history: [...(prev.history || []), { at, why: info.why || '' }].slice(-20),
    extra: { ...(prev.extra || {}), ...(info.extra || {}) },
  }
  db[k] = merged
  save(file, db)
  return merged
}

export function lookup(objKey, opts = {}) {
  const file = opts.file || path.join(opts.root || process.cwd(), DEFAULT_FILE)
  const db = load(file)
  return db[String(objKey || '').trim()] || null
}

export function listAll(opts = {}) {
  const file = opts.file || path.join(opts.root || process.cwd(), DEFAULT_FILE)
  const db = load(file)
  return Object.keys(db).sort().map((k) => ({ obj: k, ...db[k] }))
}

export function brief(objKey, opts = {}) {
  const r = lookup(objKey, opts)
  if (!r) return `${objKey}：账上还没有这个对象。改完请记一条（noteTouch），否则下次接手的人还是要靠 grep。`
  const lack = []
  if (!r.points.length) lack.push('消费点清单（points）')
  if (!r.usedBy.length) lack.push('谁依赖它（usedBy）')
  if (!r.why) lack.push('为什么改（why）')
  return [
    `${objKey}（${r.scope === 'global' ? '全局' : '局部'}，改过 ${r.n} 次，最后 ${r.at}）`,
    `  定义在：${r.file || '（未记）'}`,
    `  要跟着改：${r.usedBy.length ? r.usedBy.join(' / ') : '（未记）'}`,
    `  具体消费点：${r.points.length ? r.points.join(' / ') : '（未记）'}`,
    `  依赖：${r.deps.length ? r.deps.join(' / ') : '（无）'}`,
    `  为什么改：${r.why || '（未记）'}`,
    lack.length ? `  ⚠️ 信息不全，缺：${lack.join(' / ')}` : '  ✅ 信息齐',
  ].join('\n')
}

export const TOUCH_FILE = DEFAULT_FILE

export function audit(opts = {}) {
  const all = listAll(opts)
  const warnings = []
  const LIM = { objects: 300, pointsPerObj: 40, usedByPerObj: 40, nPerObj: 50 }
  if (all.length > LIM.objects) warnings.push(`对象数 ${all.length} 超过 ${LIM.objects} —— 该按模块前缀分组了`)
  for (const r of all) {
    if (r.points.length > LIM.pointsPerObj) warnings.push(`${r.obj}：消费点 ${r.points.length} 条超过 ${LIM.pointsPerObj} —— 可能该拆成两个对象`)
    if (r.usedBy.length > LIM.usedByPerObj) warnings.push(`${r.obj}：依赖方 ${r.usedBy.length} 条超过 ${LIM.usedByPerObj} —— 这个对象可能管太宽`)
    if (r.n > LIM.nPerObj) warnings.push(`${r.obj}：改过 ${r.n} 次超过 ${LIM.nPerObj} —— 反复改同一个地方，可能问题不在这个地方`)
  }
  return { total: all.reduce((s, r) => s + r.points.length, 0), objects: all.length, warnings }
}
