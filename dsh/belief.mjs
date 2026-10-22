
export const P_FLOOR = 0.40
export const P_DEAD_TOP = 0.70
export const LR_CAP = 50
export const BRIER_BAD = 0.25
export const EPS = 1e-6

export const LR_NOISE_LO = 0.80
export const LR_NOISE_HI = 1.25
export const MIN_CONTRA_FOR_CONTRACT = 2
export const P_MIN = 0.01
export const P_MAX = 0.99

export const W_RECEIPT = { verified: 1.0, artifact: 0.6, none: 0.0 }

export const EPS_MOVE = 0.005
export const P_SAT_BAND = 0.011

export const W_PRECEDENT = { SAME: 0.4, DIVERGE: 0.8 }
export const HIT_DECLARED_FACTOR = 0.7

export function clamp01(x) {
  if (!Number.isFinite(x)) return 0.5
  return Math.min(1 - EPS, Math.max(EPS, x))
}
export function clampP(x) {
  if (!Number.isFinite(x)) return 0.5
  return Math.min(P_MAX, Math.max(P_MIN, x))
}
export function logit(p) {
  const q = clamp01(p)
  return Math.log(q / (1 - q))
}
export function sigmoid(x) {
  if (x >= 0) return 1 / (1 + Math.exp(-x))
  const e = Math.exp(x)
  return e / (1 + e)
}

export function newBelief(o) {
  const prior = clampP(Number(o.prior ?? 0.5))
  return {
    id: o.id ?? null,
    claim: String(o.claim ?? ''),
    prior,
    p: prior,
    p_peak: prior,
    hist: [{ p: prior, at: o.at ?? null, why: 'prior' }],
    evidence: [],
    assumptions: (o.assumptions || []).slice(),
    depends_on: (o.depends_on || []).slice(),
    done_when: o.done_when ?? '',
    source: o.source ?? 'agent',
    status: 'alive',
    unreceipted: 0,
    n_updates: 0,
    n_contra: 0,
    n_contra_eff: 0,
    n_sat: 0,
    n_support: 0,
    n_support_eff: 0,
    brier: [],
  }
}

export function admit(ev) {
  if (!ev) return { ok: false, w: 0, reason: '空证据' }
  if (ev.evidenceClass === 'precedent') {
    return { ok: false, w: 0,
      reason: '先例类不走贝叶斯（由 observeRound 记入 e.precedents，作为升维的输入）' }
  }
  if (ev.evidenceClass === 'judg') {
    return { ok: false, w: 0, reason: '判断类不是证据（LR≈1）。要当证据，必须给可执行回执' }
  }
  if (!ev.receipt || !String(ev.receipt).trim()) {
    return { ok: false, w: 0, reason: '无回执（receipt 空）⇒ 无法区分"真看到"与"编出来"⇒ 本机制不收' }
  }
  const p1 = Number(ev.pE_if_true)
  const p0 = Number(ev.pE_if_false)
  if (!Number.isFinite(p1) || !Number.isFinite(p0)) {
    return { ok: false, w: 0, reason: '缺 pE_if_true / pE_if_false ⇒ 没有先立预期 ⇒ 不是证据，是事后诸葛亮' }
  }
  const lrPeek = p1 / clamp01(p0)
  if (lrPeek > LR_NOISE_LO && lrPeek < LR_NOISE_HI) {
    return { ok: false, w: 0,
      reason: `LR=${lrPeek.toFixed(3)} 落在 (${LR_NOISE_LO}, ${LR_NOISE_HI}) ⇒ 这个观测在"真"和"假"两个世界里同样可能出现 ⇒ 推不动信念（僵/马后炮）` }
  }
  const grade = ev.receiptGrade || (ev.verified ? 'verified' : 'artifact')
  const w = W_RECEIPT[grade] ?? W_RECEIPT.artifact
  return { ok: w > 0, w, reason: w > 0 ? `收（基础 w=${w.toFixed(2)}，回执=${grade}）` : '回执等级为零权重' }
}

export function judgeHit(ev) {
  const pred = ev.expect
  const obs = ev.observed
  if (typeof pred === 'number' && Number.isFinite(Number(obs))) {
    const tol = Number.isFinite(Number(ev.tol)) ? Number(ev.tol) : 0
    return { hit: Math.abs(Number(obs) - pred) <= tol, hit_by: 'computed',
      why: `|${obs} − ${pred}| ≤ ${tol}` }
  }
  const s = (x) => String(x ?? '').trim()
  const P = s(pred)
  const O = s(obs)
  if (P && O && P === O) {
    return { hit: true, hit_by: 'computed', why: '预期与观测完全相等' }
  }
  const NEG = /[未不没无非否别]/
  const containsClean = (L, S) => {
    let i = L.indexOf(S)
    while (i >= 0) {
      const prev = L.slice(0, i).replace(/[\s`"'（(【\[：:，,；;]+$/, '').slice(-1)
      if (!prev || !NEG.test(prev)) return true
      i = L.indexOf(S, i + 1)
    }
    return false
  }
  if (P && O && containsClean(O, P)) {
    return { hit: true, hit_by: 'computed', why: '观测包含该判据，且该处未被否定前缀否定' }
  }
  if (P && O && containsClean(P, O)) {
    return { hit: !!ev.hit, hit_by: 'declared',
      why: `观测只是判据的一段（不足以判全中）⇒ 降为自述，权重 ×${HIT_DECLARED_FACTOR}` }
  }
  if (P && O) {
    const longish = (x) => x.length > 20 || /[。；，、！？!?;,]/.test(x)
    if (!longish(P) && !longish(O)) {
      return { hit: false, hit_by: 'computed', why: '短断言且既不相等也不互为子串 ⇒ 说的是两件事，判不符' }
    }
    return { hit: !!ev.hit, hit_by: 'declared',
      why: `长叙述互不包含（文本层面判不出方向）⇒ 降为自述，权重 ×${HIT_DECLARED_FACTOR}；`
        + '要机器判，请把 expect/observed 写成可数的量（数字 + tol）' }
  }
  return { hit: !!ev.hit, hit_by: 'declared', why: '无结构化 expect/observed ⇒ 采用自述命中（权重打折）' }
}

export function update(b, ev) {
  if (ev && ev.hit_by === 'computed') {
    ev = { ...ev, hit_by: 'declared', _hit_by_downgraded: true }
  }
  const g = admit(ev)
  if (!g.ok) {
    if (!ev?.receipt) b.unreceipted += 1
    b.evidence.push({ ...ev, admitted: false, reason: g.reason, at: ev?.at ?? null })
    return { ok: false, lr: 1, p_from: b.p, p_to: b.p, delta: 0, reason: g.reason }
  }
  const j = ev.hit_by ? { hit: !!ev.hit, hit_by: ev.hit_by, why: '' } : judgeHit(ev)
  const wEff = j.hit_by === 'declared' ? g.w * HIT_DECLARED_FACTOR : g.w
  const p1 = clamp01(Number(ev.pE_if_true))
  const p0 = clamp01(Number(ev.pE_if_false))

  if ((p1 > p0) !== !!j.hit) {
    const reason = `p1/p0 与 expect/observed 方向相反：判「${j.hit ? '符合' : '不符合'}预期」，`
      + `却填 p1=${p1} ${p1 > p0 ? '>' : '<'} p0=${p0} ⇒ 填反了，拒收（否则证据会朝反方向推）`
    b.evidence.push({
      ...ev, admitted: false, reason, hit: j.hit, hit_by: j.hit_by,
      hit_why: j.why || '', at: ev.at ?? null,
    })
    return { ok: false, lr: 1, p_from: b.p, p_to: b.p, delta: 0, reason }
  }

  let lr = p1 / Math.max(p0, 1e-9)
  lr = Math.min(LR_CAP, Math.max(1 / LR_CAP, lr))
  const pFrom = b.p
  const step = wEff * Math.log(lr)
  const pTo = clampP(sigmoid(logit(pFrom) + step))

  b.p = pTo
  b.p_peak = Math.max(b.p_peak, pTo)
  b.n_updates += 1
  const moved = Math.abs(pTo - pFrom) > EPS_MOVE
  const sat = (pTo <= P_MIN + P_SAT_BAND) || (pTo >= P_MAX - P_SAT_BAND)
  if (lr < 1) {
    b.n_contra += 1
    if (moved) b.n_contra_eff = (b.n_contra_eff || 0) + 1
  } else if (lr > 1) {
    b.n_support += 1
    if (moved) b.n_support_eff = (b.n_support_eff || 0) + 1
  }
  if (!moved && sat) b.n_sat = (b.n_sat || 0) + 1
  const atRecv = ev.at || new Date().toISOString()
  b.hist.push({
    p: pTo, at: atRecv, delta: pTo - pFrom, moved, sat,
    why: `${j.hit ? '命中' : '不符'} ⇒ LR=${lr.toFixed(3)} w=${wEff.toFixed(2)}`
      + `${j.hit_by === 'declared' ? '（自述，已打折）' : ''}`
      + `${!moved ? (sat ? '（已饱和：p 在边界，推不动）' : '（零移动：这条观察没改变置信度）') : ''}`,
  })
  b.evidence.push({
    ...ev, admitted: true, lr, w: wEff, hit: j.hit, hit_by: j.hit_by, hit_why: j.why || '',
    p_from: pFrom, p_to: pTo, at: atRecv, moved, sat,
  })
  return { ok: true, lr, p_from: pFrom, p_to: pTo, delta: pTo - pFrom, moved, sat,
    reason: `${j.hit ? '命中预期' : '与预期不符'} → LR ${lr.toFixed(2)}，p ${pFrom.toFixed(3)} → ${pTo.toFixed(3)}`
      + `${moved ? '' : (sat ? '（已饱和，未动）' : '（零移动）')}` }
}

export function shouldContract(b) {
  return b.status === 'alive'
    && b.p < P_FLOOR
    && b.p_peak >= P_DEAD_TOP
    && (b.n_contra || 0) >= MIN_CONTRA_FOR_CONTRACT
}

export function contract(b, why) {
  b.status = '已回到空'
  b.hist.push({ p: b.p, at: new Date().toISOString(), why: `回到空：${why}` })
  return {
    retracted: b.assumptions.slice(),
    cascade: b.depends_on.slice(),
    why,
  }
}

export function recordOutcome(b, outcome) {
  b.brier.push({ p: b.p, outcome: outcome ? 1 : 0 })
  return brierOf(b)
}

export function brierOf(b) {
  if (!b.brier.length) return null
  return b.brier.reduce((a, s) => a + (s.p - s.outcome) ** 2, 0) / b.brier.length
}

export function calibration(beliefs) {
  const m = new Map()
  for (const b of beliefs || []) {
    if (!b.brier.length) continue
    const k = b.source || 'agent'
    if (!m.has(k)) m.set(k, { n: 0, sum: 0 })
    const g = m.get(k)
    for (const s of b.brier) { g.sum += (s.p - s.outcome) ** 2; g.n += 1 }
  }
  const out = {}
  for (const [k, g] of m) {
    const br = g.sum / Math.max(1, g.n)
    out[k] = { n: g.n, brier: br, weight: br > BRIER_BAD ? 0.5 : 1.0 }
  }
  return out
}

export function newHazardStore() {
  return { seq: 0, items: {} }
}

export function openHazard(store, h) {
  if (!store) store = newHazardStore()
  store.seq += 1
  const id = h.id || `H-${store.seq}`
  store.items[id] = {
    id,
    from: h.from ?? null,
    what: String(h.what ?? ''),
    where: String(h.where ?? ''),
    fire_when: String(h.fire_when ?? ''),
    due_round: h.due_round ?? null,
    assumption: String(h.assumption ?? ''),
    status: 'open',
    opened_at: new Date().toISOString(),
    fired_at: null,
    accepted: null,
  }
  return store.items[id]
}

export function fireHazard(store, id, { evidence } = {}) {
  const h = store?.items?.[id]
  if (!h) return { ok: false, reason: `无此隐患 ${id}` }
  if (h.status === 'accepted') return { ok: false, reason: `${id} 已被显式接受（共存），不判为取错` }
  h.status = 'fired'
  h.fired_at = new Date().toISOString()
  h.fire_evidence = evidence ?? null
  return {
    ok: true,
    retract_assumption: h.assumption || null,
    from: h.from,
    why: `隐患 ${id} 复发（${h.fire_when || '判据未写'}）⇒ 当初把矛盾推到这里的那一步是错的 ⇒ 回到空重取`,
  }
}

export function acceptHazard(store, id, { by, cost, until } = {}) {
  const h = store?.items?.[id]
  if (!h) return { ok: false, reason: `无此隐患 ${id}` }
  if (!by || !cost) return { ok: false, reason: '接受隐患必须写 by（谁接受）+ cost（代价是什么），否则是装作不存在' }
  h.status = 'accepted'
  h.accepted = { by, cost, until: until ?? null, at: new Date().toISOString() }
  return { ok: true, why: `隐患 ${id} 转为「接受的欠账」：代价 ${cost}` }
}

export function dueHazards(store, roundNo) {
  const items = Object.values(store?.items ?? {})
  return items.filter((h) => h.status === 'open'
    && ((h.due_round !== null && h.due_round !== undefined && Number(roundNo) >= Number(h.due_round))
      || h.fire_when))
}

export function hazardSummary(store) {
  const items = Object.values(store?.items ?? {})
  const by = { open: 0, fired: 0, accepted: 0 }
  for (const h of items) by[h.status] = (by[h.status] || 0) + 1
  return { ...by, total: items.length, open_items: items.filter((h) => h.status === 'open') }
}

export const LIFT_FIELDS = ['old_dead', 'new_vars', 'new_boundary', 'new_contra', 'new_criterion', 'expect']

export function diagnoseLiftFull(node, oldVars = []) {
  const miss = []
  const vars = Array.isArray(node?.new_vars) ? node.new_vars : (Array.isArray(node?.variables) ? node.variables : [])
  const old = new Set(oldVars || [])
  const nv = [...new Set(vars)].filter((v) => !old.has(v))

  if (!node?.old_dead) miss.push('old_dead（旧层哪条命题死了、p 多少）')
  if (!vars.length || !nv.length) miss.push('new_vars（引入旧层不存在的变量——集合减法为空 = 执）')
  if (!String(node?.new_boundary ?? '').trim()) miss.push('new_boundary（新变量带来的边界）')
  if (!String(node?.new_contra ?? '').trim()) miss.push('new_contra（边界立刻产生的矛盾）')
  if (!String(node?.new_criterion ?? '').trim()) miss.push('new_criterion（新层可执行判据）')
  if (!node?.expect) miss.push('expect（新层第一个可证伪预测）')

  if (miss.length) {
    return { ok: false, kind: '执', newVars: nv, missing: miss,
      why: `六项缺 ${miss.length} 项 ⇒ 这不是升维，是守旧边界换说法：${miss.join('；')}` }
  }
  return { ok: true, kind: '取', newVars: nv, missing: [],
    why: `引入新变量 ${nv.join('、')}；新边界「${node.new_boundary}」带来新矛盾「${node.new_contra}」` }
}

export function buildMustAnswer({ questions = {}, beliefs = [], hazards = null, round = 0 } = {}) {
  const out = []

  const qs = Object.entries(questions)
    .filter(([, q]) => q && q.status === 'active' && (!q.rids || q.rids.length === 0))
    .sort((a, b) => (Number(b[1].weight ?? 50) - Number(a[1].weight ?? 50)))
  if (qs.length) out.push({ kind: 'question', id: qs[0][0], text: qs[0][1].text ?? '',
    expect: '用 brain_observe 带 answers:"' + qs[0][0] + '" 回答它（或 brain_dissolve 说明为何消解）' })

  const alive = (beliefs || []).filter((b) => b.status === 'alive')
  if (alive.length) {
    const low = alive.reduce((m, b) => (b.p < m.p ? b : m), alive[0])
    if (low.p < 0.75) {
      out.push({ kind: 'belief', id: low.id ?? low.claim, text: low.claim,
        p: low.p,
        expect: `p=${low.p.toFixed(3)} 偏低 ⇒ 给一条带回执的新证据，或显式知止（写明为什么不再需要它）` })
    }
  }

  const dues = dueHazards(hazards, round)
  if (dues.length) {
    const h = dues[0]
    out.push({ kind: 'hazard', id: h.id, text: `${h.what} → ${h.where}`,
      expect: `第 ${round} 轮已到：判它是否复发（fire）或显式接受（accept，须写代价）` })
  }
  return out
}

export function reconcileMustAnswer(prev = [], seen = {}) {
  const miss = []
  for (const item of prev || []) {
    const k = `${item.kind}:${item.id}`
    if (!seen[k]) miss.push({ ...item, missed: true })
  }
  return miss
}
