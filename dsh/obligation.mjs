
import * as LD from './layer.mjs'

export const OB_KIND = {
  evidence: '欠一条能判这条矛盾成不成立的证据',
  retake: '欠一次重取（父层重新定义后再取一次）',
  receipt: '欠一个回执（升维任务的三态回执 / 里程碑验绿）',
  revisit: '欠一次到期回访（留空的那一格）',
}
export const OB_KINDS = Object.keys(OB_KIND)

export const OB_STATE = ['open', 'settled', 'absorbed', 'void']

export const OB_CAL = 1

export const OB_UNKNOWN = 'unknown'

export function newObligationStore() {
  return { items: {}, seq: 0, cal: OB_CAL, opened_total: 0, hist: [] }
}

const now = () => new Date().toISOString()

function e(tag) {
  const err = new Error(tag)
  err.ob = tag
  return err
}

export function openOb(store, o = {}) {
  if (!store) return { ok: false, why: '无账本' }
  const kind = String(o.kind || '')
  if (!OB_KINDS.includes(kind)) {
    return { ok: false, why: `义务种类要落在四种之一（${OB_KINDS.join('/')}），收到「${kind || '空'}」` }
  }
  const at = String(o.at ?? '').trim()
  if (!at) return { ok: false, why: '义务要挂在某个对象上（at：矛盾 id / 里程碑 id / 任务 id）' }
  const what = String(o.what ?? OB_KIND[kind]).trim()

  const dup = Object.values(store.items)
    .find((x) => x.state === 'open' && x.kind === kind && x.at === at && x.what === what)
  if (dup) return { ok: true, id: dup.id, dup: true, item: dup }

  store.seq = (store.seq || 0) + 1
  const id = `OB-${store.seq}`
  store.items[id] = {
    id, kind, at, what,
    state: 'open',
    opened_at: o.opened_at || now(),
    opened_seq: Number.isFinite(o.opened_seq) ? o.opened_seq : null,
    cal: Number(store.cal ?? OB_CAL),
    scope: o.scope || null,
    ...(o.from ? { from: String(o.from) } : {}),
  }
  store.opened_total = (store.opened_total || 0) + 1
  return { ok: true, id, item: store.items[id] }
}

export function settleOb(store, id, o = {}) {
  const it = store?.items?.[String(id)]
  if (!it) return { ok: false, why: `无此义务 ${id}` }
  if (it.state !== 'open') return { ok: false, why: `${id} 已是 ${it.state}，不重复终了` }
  const how = String(o.how ?? o.evidence ?? '').trim()
  if (!how) return { ok: false, why: '还账要写明还的是什么（how：证据内容 / 命令 / 路径），否则说不清它还过' }
  it.state = 'settled'
  it.closed_at = o.closed_at || now()
  it.closed_seq = Number.isFinite(o.closed_seq) ? o.closed_seq : null
  it.how = how
  return { ok: true, id, state: 'settled' }
}

const VOID_VAGUE = /^(不需要了|不用了|不必了|取消了|不做了|先这样|无关|n\/a|无)[。.\s]*$/i
export function voidOb(store, id, o = {}) {
  const it = store?.items?.[String(id)]
  if (!it) return { ok: false, why: `无此义务 ${id}` }
  if (it.state !== 'open') return { ok: false, why: `${id} 已是 ${it.state}，不重复终了` }
  const why = String(o.why ?? '').trim()
  if (why.length < 8 || VOID_VAGUE.test(why)) {
    return {
      ok: false,
      why: '销账要说清**为什么这条不必交了**（具体到能复核：是问题被重新定义了、还是它被判伪了）。'
        + '写"不需要了"就是在用免票通道 —— 那是这本账唯一会被攻破的地方。',
    }
  }
  const kind = String(o.kind ?? '').trim()
  if (!kind) {
    return {
      ok: false,
      why: '销账要说清是**哪一种不存在**：redefine（重新定义，问题没了）/ fake（它被判伪了）'
        + ' / superseded（被另一条取代了）/ scope（落在讨论边界之外了）。'
        + '不分类 ⇒ 「问题没了」和「我不想做了」盘上看不出区别。',
    }
  }
  it.state = 'void'
  it.closed_at = o.closed_at || now()
  it.closed_seq = Number.isFinite(o.closed_seq) ? o.closed_seq : null
  it.void = { why, kind, at: it.closed_at }
  return { ok: true, id, state: 'void' }
}

export function absorbOb(store, id, o = {}) {
  const it = store?.items?.[String(id)]
  if (!it) return { ok: false, why: `无此义务 ${id}` }
  if (it.state !== 'open') return { ok: false, why: `${id} 已是 ${it.state}，不重复终了` }
  const by = String(o.by ?? '').trim()
  if (by === it.id) {
    return { ok: false, why: '承接者不能是它自己 ⇒ 自己接自己，账永远清不掉' }
  }
  const rel = LD.contain(store?.items, it, { by, why: o.why, at_seq: o.at_seq ?? null })
  if (!rel.ok) return rel
  const why = String(o.why ?? '').trim()
  if (why.length < 8) {
    return {
      ok: false,
      why: '承接要说清**上层为什么接得住这条**（8 字以上，具体到能复核）：'
        + '是范围把它包进来了，还是它现在归上面那条管。',
    }
  }
  it.state = 'absorbed'
  it.closed_at = o.closed_at || now()
  it.closed_seq = Number.isFinite(o.closed_seq) ? o.closed_seq : null
  it.absorbed = { by, why, at: it.closed_at, ...rel.rel }
  return { ok: true, id, state: 'absorbed', by }
}

function closeWhere(store, at, fn, o) {
  const ids = Object.values(store?.items || {})
    .filter((x) => x.state === 'open' && x.at === String(at))
    .map((x) => x.id)
  const out = []
  for (const id of ids) {
    const r = fn(store, id, o)
    out.push({ id, ok: !!r.ok, ...(r.ok ? {} : { why: r.why }) })
  }
  return { ids, results: out, n: out.filter((r) => r.ok).length }
}

export function settleWhere(store, at, o = {}) {
  return closeWhere(store, at, settleOb, o)
}

export function voidWhere(store, at, o = {}) {
  return closeWhere(store, at, voidOb, o)
}

export function absorbWhere(store, at, o = {}) {
  return closeWhere(store, at, absorbOb, o)
}

export function owedBy(store, at) {
  return Object.values(store?.items || {})
    .filter((x) => x.state === 'open' && x.at === String(at))
}

export function voidIfStale(store) {
  if (!store) return null
  const cal = Number(store.cal ?? 0)
  if (cal >= OB_CAL) return null
  const before = Object.values(store.items).filter((x) => Number(x.cal ?? 0) < OB_CAL)
  for (const it of before) {
    it.state = 'void'
    it.void = { why: `义务口径 v${cal} → v${OB_CAL}，旧账不可比`, kind: 'caliber', at: now() }
    it.cal_migrated = true
  }
  if (!before.length) { store.cal = OB_CAL; return null }
  store.hist = store.hist || []
  store.hist.push({ from: cal, to: OB_CAL, voided: before.length, at: now() })
  store.cal = OB_CAL
  return { before: before.length, from: cal, to: OB_CAL }
}

export function summarizeOb(store) {
  const items = Object.values(store?.items || {})
  const by = { open: 0, settled: 0, absorbed: 0, void: 0 }
  const byKind = {}
  const byVoidKind = {}
  for (const it of items) {
    by[it.state] = (by[it.state] || 0) + 1
    if (it.state === 'open') byKind[it.kind] = (byKind[it.kind] || 0) + 1
    if (it.state === 'void') {
      const k = it.void?.kind || 'unknown'
      byVoidKind[k] = (byVoidKind[k] || 0) + 1
    }
  }
  const total = items.length
  const orphaned = items.filter((x) => x.state === 'absorbed'
    && store.items?.[String(x.absorbed?.by)]?.state === 'void')
  return {
    cal: Number(store?.cal ?? OB_CAL),
    total, ...by,
    byKind, byVoidKind,
    payRate: (by.open + by.settled + by.absorbed)
      ? by.settled / (by.open + by.settled + by.absorbed) : null,
    voidRate: total ? by.void / total : null,
    absorbRate: total ? by.absorbed / total : null,
    orphaned: orphaned.map((x) => x.id),
    openIds: items.filter((x) => x.state === 'open').map((x) => x.id),
  }
}

export function obLights(store) {
  const s = summarizeOb(store)
  const lights = []
  if (!s.total) return { lights, s }
  const voidN = s.void
  const settleN = s.settled
  if (voidN >= 3 && voidN > settleN) {
    const kinds = Object.entries(s.byVoidKind).sort((a, b) => b[1] - a[1])
    lights.push(`🟠 义务账销了 ${voidN} 条、只还了 ${settleN} 条 ⇒ 减债靠的是「重新定义」而不是交证据`
      + `（销账理由分布：${kinds.map(([k, n]) => `${k}×${n}`).join('、')}）。`
      + '出口两条：① 去把还欠着的那几条真交了；② 逐条复核销掉的那几条 —— 它们真的是"不存在了"，还是"不想做了"？')
  }
  const top = Object.entries(s.byVoidKind).sort((a, b) => b[1] - a[1])[0]
  if (top && top[1] >= 3) {
    lights.push(`🟡 「${top[0]}」这一种销账理由用了 ${top[1]} 次 ⇒ 三个独立判断长成一样，通常意味着它是一张通用免票，`
      + '不是三条各自的理由。翻一下那几条的 why，看它们是不是同一句话换个 id。')
  }
  if (s.open >= 5) {
    lights.push(`⚪ 还欠着 ${s.open} 条义务（${s.openIds.slice(0, 5).join('、')}）`
      + ' —— 不催，但每一条都在账上，收尾时它们会被问到。')
  }
  if (s.orphaned?.length) {
    lights.push(`🔴 悬空承接 ${s.orphaned.length} 条（${s.orphaned.join('、')}）：`
      + '当初说"被上层接走了"，而那个上层自己后来被销账了 ⇒ 现在**没有任何一条义务在管这件事**。'
      + '出口：要么把承接关系改挂到还在盘上的那条上，要么承认它其实还欠着。')
  }
  if (s.absorbed >= 3 && s.absorbed > s.settled && s.absorbed > s.void) {
    lights.push(`🟡 承接 ${s.absorbed} 条 > 还账 ${s.settled} 条 ⇒ 义务在被往上层推，不在被解决。`
      + '包含本身正当，但要看那几条承接者自己是不是也在欠着 —— 一路上推，最后谁还？')
  }
  return { lights, s }
}

export function obLine(store) {
  const s = summarizeOb(store)
  if (!s.total) return null
  const rate = s.payRate === null ? '' : `；还了 ${(s.payRate * 100).toFixed(0)}%（分母＝还该还的，不含销掉的）`
  return `义务账 v${s.cal}：欠 ${s.open} / 还 ${s.settled} / 承接 ${s.absorbed} / 销 ${s.void}${rate}`
}

export default {
  OB_KIND, OB_KINDS, OB_STATE, OB_CAL, OB_UNKNOWN,
  newObligationStore, openOb, settleOb, voidOb, absorbOb,
  settleWhere, voidWhere, absorbWhere,
  owedBy, voidIfStale, summarizeOb, obLights, obLine,
}
