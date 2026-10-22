
export const U_STATE = Object.freeze({
  RAW: 'raw',
  CLASSIFIED: 'classified',
  ABSORBED: 'absorbed',
  REJECTED: 'rejected',
})

export const U_SOURCE = Object.freeze({
  OFF_CONTRACT: 'off-contract',
  DEVIATION: 'deviation',
  HUMAN: 'human',
  OBSERVED: 'observed',
})

export function newPool() {
  return { items: {}, seq: 0, waterline: 10 }
}

export function capture(pool, { source, raw, from = '', at = new Date().toISOString() } = {}) {
  if (!pool) throw new Error('unknown.capture 需要 pool')
  if (!Object.values(U_SOURCE).includes(source)) throw new Error(`source 非法：${source}`)
  const s = String(raw || '').trim()
  if (!s) throw new Error('raw 不能为空（空捕获 = 噪音）')
  const n = (pool.seq = (pool.seq || 0) + 1)
  const id = `U${n}`
  pool.items[id] = { id, source, raw: s.slice(0, 500), from: String(from).slice(0, 80), state: U_STATE.RAW, at, into: null, why: '' }
  return id
}

export function classify(pool, id, { into, why = '' } = {}) {
  const it = pool?.items?.[id]
  if (!it) return { ok: false, why: `没有 ${id}` }
  if (it.state !== U_STATE.RAW) return { ok: false, why: `${id} 当前是 ${it.state}，只有 raw 能分类` }
  if (!String(into || '').trim()) return { ok: false, why: 'classify 要给 into（归到哪条契约/里程碑）——否则只是"看过了"' }
  it.state = U_STATE.CLASSIFIED
  it.into = String(into)
  it.why = String(why).slice(0, 200)
  return { ok: true, item: it }
}

export function absorb(pool, id) {
  const it = pool?.items?.[id]
  if (!it) return { ok: false, why: `没有 ${id}` }
  if (it.state === U_STATE.RAW) return { ok: false, why: `${id} 还是 raw ⇒ 不许直接 absorbed（原文：raw 条目必须人工分类后才 absorbed）` }
  if (it.state !== U_STATE.CLASSIFIED) return { ok: false, why: `${id} 当前是 ${it.state}` }
  it.state = U_STATE.ABSORBED
  return { ok: true, item: it }
}

export function reject(pool, id, why) {
  const it = pool?.items?.[id]
  if (!it) return { ok: false, why: `没有 ${id}` }
  if (!String(why || '').trim()) return { ok: false, why: 'reject 要给 why（没有理由的拒收 = 装作没看见）' }
  it.state = U_STATE.REJECTED
  it.why = String(why).slice(0, 200)
  return { ok: true, item: it }
}

export function waterline(pool, cfg = {}) {
  const lim = Number(cfg.unknownWaterline ?? pool?.waterline ?? 10)
  const open = Object.values(pool?.items || {}).filter((x) => x.state === U_STATE.RAW || x.state === U_STATE.CLASSIFIED)
  return {
    open: open.length,
    limit: lim,
    over: open.length > lim,
    ids: open.map((x) => x.id),
    why: open.length > lim
      ? `未处理 ${open.length} 条 > 水位 ${lim} ⇒ **不许标完成**（原文：未处理超线任务不能标记完成）；出口：absorb 或 reject（reject 要写为什么）`
      : `未处理 ${open.length}/${lim}`,
  }
}

export function brief(pool, cfg = {}) {
  const w = waterline(pool, cfg)
  if (!w.open) return null
  if (w.over) return `🟠 ${w.why}（${w.ids.slice(0, 6).join('、')}）`
  const rawN = Object.values(pool?.items || {}).filter((x) => x.state === U_STATE.RAW).length
  if (rawN) return `· 未知池 ${w.open} 条未处理（其中 ${rawN} 条 raw）—— **raw 要分类后才能吸收**（那是"无"进来的地方，别当噪音删掉）`
  return null
}
