
export const RING = Object.freeze({
  EMPTY: 'empty',
  EXPLORE: 'explore',
  BUILD: 'build',
  STUCK: 'stuck',
  DONE: 'done',
})

export function ringOf(st = {}) {
  const tasks = Object.values(st.tree?.tasks || {}).filter((t) => t && t.id !== 'META' && t.status !== 'superseded' && t.status !== 'invalid')
  const ms = Object.values(st.plan?.milestones || {}).filter((m) => m && m.status !== 'dropped')
  const pending = ms.filter((m) => m.status === 'pending' || m.status === 'blocked')
  const done = ms.filter((m) => m.status === 'done')
  const tried = ms.filter((m) => Number(m.verify_n || 0) >= 3)

  if (!tasks.length && !ms.length) return { ring: RING.EMPTY, why: '没有任务也没有里程碑' }
  if (tasks.length && !ms.length) return { ring: RING.EXPLORE, why: `${tasks.length} 条任务、0 个里程碑 ⇒ 还在拆` }
  if (ms.length && !pending.length && done.length === ms.length) return { ring: RING.DONE, why: `${done.length}/${ms.length} 全绿` }
  if (tried.length && !done.length) return { ring: RING.STUCK, why: `${tried.length} 条里程碑验了 ≥3 次仍不绿` }
  return { ring: RING.BUILD, why: `${pending.length} 个 pending / ${ms.length} 个里程碑` }
}

export function mainContradiction(st = {}) {
  const out = []

  for (const [id, n] of Object.entries(st.contra?.nodes || {})) {
    if (!n || n.status === 'solved' || n.status === 'redefined') continue
    const p = Number(n.p ?? 0.5)
    out.push({ src: 'contra', id, a: n.a || '', b: n.b || '', strength: Math.max(0, 1 - p), why: String(n.statement || '').slice(0, 60) })
  }

  const ms = Object.values(st.plan?.milestones || {}).filter((m) => m && m.status !== 'done')
  const byTarget = new Map()
  for (const m of ms) {
    const w = m.done_when || {}
    const key = String(w.cmd || (Array.isArray(w.artifacts) ? w.artifacts.join(',') : '') || '').trim()
    if (!key) continue
    if (!byTarget.has(key)) byTarget.set(key, [])
    byTarget.get(key).push(m.id)
  }
  for (const [key, ids] of byTarget) {
    if (ids.length < 2) continue
    out.push({ src: 'evidence', id: ids.join('+'), a: ids[0], b: ids[1], strength: 0.5 + 0.1 * (ids.length - 2), why: `共用同一份判据（${key.slice(0, 40)}）⇒ 谁绿谁不算绿` })
  }

  for (const t of Object.values(st.tree?.tasks || {})) {
    for (const c of (t.conflicts || [])) out.push({ src: 'task', id: `${t.id}×${c}`, a: t.id, b: c, strength: 0.9, why: '用户明说这两条互斥' })
  }

  out.sort((x, y) => y.strength - x.strength)
  return { main: out[0] || null, all: out, why: out.length ? `最强的是 ${out[0].id}（${out[0].strength.toFixed(2)}）` : '账里没有可判的矛盾（不编）' }
}

export function perceive(st = {}) {
  const r = ringOf(st)
  const c = mainContradiction(st)
  return { ...r, ...c, brief: `环=${r.ring}｜${c.main ? `主要矛盾=${c.main.id}(${c.main.strength.toFixed(2)}) ${c.main.why}` : `主要矛盾=暂无（${c.why}）`}` }
}
