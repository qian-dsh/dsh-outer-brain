
export const LAYER_CAL = 1

export const LIFT_VERDICT = {
  lift: '升',
  same: '执',
  empty: '空',
}

const now = () => new Date().toISOString()

export function scopeOf(x) {
  if (!x || typeof x !== 'object') return null
  if (x.scope && typeof x.scope === 'object') {
    const r = scopeOf(x.scope)
    if (r) return { ...r, id: x.id ?? x.scope?.id ?? null }
  }
  const fin = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)
  const from = fin(x.seqFrom) ?? fin(x.from)
    ?? fin(x.opened_seq) ?? fin(x.at_seq)
  const to = fin(x.seqTo) ?? fin(x.to) ?? fin(x.closed_seq) ?? from
  const n = fin(x.n) ?? 1
  if (from === null && to === null) return null
  return { from: from ?? to, to: to ?? from, n }
}

export function isSuperset(a, b) {
  const A = scopeOf(a), B = scopeOf(b)
  if (!A || !B) return null
  const covers = (A.from <= B.from) && (A.to >= B.to)
  const wider = (A.to - A.from) > (B.to - B.from)
    || (Number.isFinite(A.n) && Number.isFinite(B.n) && A.n > B.n)
  return covers && wider
}

export function contain(containerStore, part, { by, why, at_seq = null, cal = LAYER_CAL } = {}) {
  if (!part || typeof part !== 'object') {
    return { ok: false, why: '被包含的对象为空 ⇒ 无从登记包含关系' }
  }
  const byId = String(by ?? '').trim()
  if (!byId) {
    return { ok: false, why: '没点名承接者（`by`）⇒ 「被上层接走了」是一句无法复核的话' }
  }
  const partId = String(part.id ?? part.key ?? '')
  if (partId && partId === byId) {
    return { ok: false, why: '承接者不能是它自己 ⇒ 自己接自己，账永远清不掉（循环承接）' }
  }
  const store = containerStore || {}
  const container = store[byId]
  if (!container) {
    return { ok: false, why: `承接者 ${byId} 不在盘上 ⇒ 这条包含关系没有落点，义务继续欠着` }
  }
  if (container.state === 'void') {
    return { ok: false, why: `承接者 ${byId} 自己已被销账 ⇒ 一个不存在的东西接不住任何东西` }
  }
  const rel = {
    part: String(part.id ?? part.key ?? ''),
    by: byId,
    why: String(why ?? ''),
    at_seq: Number.isFinite(Number(at_seq)) ? Number(at_seq) : null,
    at: now(),
    cal,
    part_scope: scopeOf(part),
    container_scope: scopeOf(container),
  }
  return { ok: true, rel }
}

export function expandScope(cur, next, { why = '', at_seq = null } = {}) {
  const cs = scopeOf(cur)
  const ns = scopeOf(next)
  if (!ns) return { ok: false, why: '新的边界不完整（from/to/n 至少要有一个）⇒ 无从判它扩大了没有' }
  const grown = cs ? isSuperset(ns, cs) : null
  const hist = [...(cur?.hist || []), ...(cs ? [{
    ...cs, why: String(why || '') ? `被扩之前：${why}` : '被扩之前的边界',
    at_seq: Number.isFinite(Number(at_seq)) ? Number(at_seq) : null, at: now(),
  }] : [])]
  return {
    ok: true,
    grown,
    scope: ns,
    hist: hist.slice(-8),
    why: grown === null ? '旧边界缺失 ⇒ 这一次无法判"是否扩大"，只做记录'
      : grown ? '边界严格扩大 ⇒ 判「升」' : '边界没有变大 ⇒ 判「执」（换了范围，没换层）',
  }
}

export function judgeLift({ oldLayer = null, newLayer = null, why = '', by = null, store = null } = {}) {
  if (!oldLayer && !newLayer) {
    return { verdict: LIFT_VERDICT.empty, why: '既没点名旧层、也没给出新层 ⇒ 无从判这是一次升维' }
  }
  if (!oldLayer) {
    return { verdict: LIFT_VERDICT.empty, why: '没点名旧层（oldLayer）⇒ 「升」是相对一个旧层说的，没有旧层就没有升' }
  }
  if (!newLayer) {
    return { verdict: LIFT_VERDICT.empty, why: '没给出新层（newLayer）⇒ 看不见扩到哪儿去了' }
  }
  if (!String(why || '').trim()) {
    return { verdict: LIFT_VERDICT.empty, why: '没说为什么这一层的边界要扩大 ⇒ 无法复核' }
  }
  const grown = isSuperset(newLayer, oldLayer)
  if (grown === null) {
    return { verdict: LIFT_VERDICT.empty, why: '两层的边界有一个不完整 ⇒ 判不出是否扩大（不是"算升"）' }
  }
  if (grown !== true) {
    return {
      verdict: LIFT_VERDICT.same,
      why: '边界没有严格变大 ⇒ 判「执」：这是在同一层里换了个范围，不是升维。'
        + '要真升，就把原来 outside 里的东西划进来。',
      old_scope: scopeOf(oldLayer), new_scope: scopeOf(newLayer),
    }
  }
  const rel = store ? contain(store, oldLayer, { by, why, at_seq: newLayer?.at_seq ?? null }) : null
  if (rel && !rel.ok) {
    return {
      verdict: LIFT_VERDICT.empty,
      why: `边界确实扩大了，但包含关系落不了地：${rel.why}`,
      old_scope: scopeOf(oldLayer), new_scope: scopeOf(newLayer),
    }
  }
  return {
    verdict: LIFT_VERDICT.lift,
    why: '边界严格扩大，且旧层被点名收进新层 ⇒ 判「升」。旧层的数据不动，它现在是整体的一部分。',
    old_scope: scopeOf(oldLayer), new_scope: scopeOf(newLayer),
    rel: rel?.rel ?? null,
  }
}

export function projectLoss({ kept = 0, total = 0, what = '', why = '' } = {}) {
  const k = Number.isFinite(Number(kept)) ? Number(kept) : 0
  const t = Number.isFinite(Number(total)) ? Number(total) : 0
  const dropped = Math.max(0, t - k)
  return {
    what: String(what || '明细'),
    kept: k, total: t, dropped,
    ratio: t > 0 ? dropped / t : null,
    why: String(why || '上一层滚进这一层时被截断 ⇒ 这一层之上的任何一层都看不见被丢掉的那些'),
    cal: LAYER_CAL,
  }
}

export function lossLine(losses) {
  const arr = (losses || []).filter((x) => x && x.dropped > 0)
  if (!arr.length) return '投影无损'
  return arr.map((x) => `${x.what} 丢 ${x.dropped}/${x.total}`).join('；')
}
