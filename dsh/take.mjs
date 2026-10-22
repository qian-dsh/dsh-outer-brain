
export const TAKE_STATE = ['given', 'blank', 'redef']

export const NO_TAKE = 'none'

export const BLANK_FACTOR = 0.6

export const REVISIT_KIND = {
  evidence: '当某条证据出现时回来填（at = 那条证据的 rid）',
  stage: '当进行到某个节点/里程碑时回来填（at = 那个 id）',
  user: '当用户对这块给出新说法时回来填（at = 用户原话里的关键词，机制只做包含判定）',
}

export function readTake(v) {
  if (v === null || v === undefined) return { state: NO_TAKE }
  if (typeof v === 'string') {
    const s = v.trim()
    if (TAKE_STATE.includes(s)) return { state: s }
    return { state: NO_TAKE }
  }
  if (typeof v !== 'object') return { state: NO_TAKE }
  const explicit = String(v.state ?? '').trim()
  if (TAKE_STATE.includes(explicit)) return { ...v, state: explicit }
  if (v.blank === true) return { ...v, state: 'blank' }
  if (v.redef === true || v.redefine === true) return { ...v, state: 'redef' }
  if (v.is || v.not || v.limit) return { ...v, state: 'given' }
  if (v.why || v.revisit || v.was || v.now) {
    return { ...v, state: NO_TAKE, why: `有字段但没标 state（${Object.keys(v).join(',')}）—— 机制不替你归类` }
  }
  return { state: NO_TAKE }
}

const VAGUE_AT = /^(以后.*|之后.*|到时候.*|有需要.*|需要时.*|视情况.*|再说.*|待定.*|未定.*|以后.*|.*的时候|later.*|todo.*|tbd.*)$/i

export function checkRevisit(rv, exists = null) {
  const kind = String(rv?.kind ?? '').trim()
  const at = String(rv?.at ?? '').trim()
  if (!REVISIT_KIND[kind]) {
    return {
      ok: false,
      why: `revisit.kind 必须是 ${Object.keys(REVISIT_KIND).join(' / ')} 之一（拿到「${kind || '空'}」）—— `
        + '留空可以，但要挂一个**机制能等**的触发；只说"以后再看"，机制判不了到期，这条空就永远不响',
    }
  }
  if (!at) return { ok: false, why: 'revisit.at 不能为空 —— 要指向一个具体的东西（rid / 节点 id / 用户原话关键词）' }
  if (VAGUE_AT.test(at)) {
    return { ok: false, why: `revisit.at「${at}」是套话 —— 到期判定跑不了。要写具体对象（例如 rid-xxx / Q3 / U1）` }
  }
  if (exists && kind !== 'user' && !exists(at)) {
    return { ok: false, why: `revisit.at「${at}」在盘上找不到 —— 挂在一个不存在的东西上的空，等于没挂` }
  }
  return { ok: true }
}

export function checkTake(need, v, opt = {}) {
  const t = readTake(v)
  const state = t.state

  if (state === NO_TAKE) {
    const why = t.why
      || `这里什么都没说（既没给，也没留空，也没重定义）—— 三种表态方式选一种都行，只有"不表态"没有出路的`
      + `（要填：${need.join(' / ')}；要留空：state:'blank' + why + revisit；要重定义：state:'redef' + was/now/why）`
    return { ok: false, state, why, factor: 0 }
  }

  if (state === 'given') {
    const miss = need.filter((k) => !String(t[k] ?? '').trim())
    if (miss.length) {
      return {
        ok: true, state: 'blank', factor: BLANK_FACTOR, half: true,
        why: `给了半张（缺 ${miss.join(' / ')}）—— 按留空处理：折扣 ${BLANK_FACTOR}，另标 half 由灯抓`,
        take: {
          state: 'blank',
          why: `给了一半：已给 ${need.filter((k) => String(t[k] ?? '').trim()).join('/') || '无'}`,
          scope: miss.join('/'),
        },
      }
    }
    return { ok: true, state, factor: 1, take: { state: 'given' } }
  }

  if (state === 'blank') {
    const why = String(t.why ?? '').trim()
    const scope = String(t.scope ?? '').trim()
    if (why.length < 6) {
      return { ok: false, state, why: `留空要写 why（为什么现在给不出，≥6 字）—— 当前「${why}」`,
        factor: BLANK_FACTOR }
    }
    if (!scope) {
      return { ok: false, state, why: '留空要写 scope（空的是哪一段 / 哪一问）—— '
        + '"整块不知道"和"not 那一问不知道"是两件事，混起来等于没标范围', factor: BLANK_FACTOR }
    }
    const rv = checkRevisit(t.revisit, opt.exists || null)
    if (!rv.ok) return { ok: false, state, why: rv.why, factor: BLANK_FACTOR }
    return {
      ok: true, state, factor: BLANK_FACTOR,
      take: { state: 'blank', why, scope, revisit: { kind: String(t.revisit.kind), at: String(t.revisit.at) } },
    }
  }

  if (state === 'redef') {
    const was = String(t.was ?? '').trim()
    const now = String(t.now ?? '').trim()
    const why = String(t.why ?? '').trim()
    if (!was) return { ok: false, state, why: '重定义要给 was（原来那个说法是什么）—— 不留旧值，就无法判断这次是重定义还是逃避', factor: 1 }
    if (!now) return { ok: false, state, why: '重定义要给 now（现在这个说法是什么）', factor: 1 }
    if (why.length < 6) return { ok: false, state, why: `重定义要给 why（旧的那个为什么不存在了，≥6 字）—— 当前「${why}」`, factor: 1 }
    if (wantSameNorm(was) === wantSameNorm(now)) {
      return { ok: false, state, why: 'was 与 now 去空白标点后完全一样 —— 这不是重定义，是把同一句话说两遍', factor: 1 }
    }
    return { ok: true, state, factor: 1, take: { state: 'redef', was, now, why } }
  }

  return { ok: false, state: NO_TAKE, why: `未识别的态「${state}」`, factor: 0 }
}

const wantSameNorm = (s) => String(s || '').replace(/[\s，。；、：:,.!?！？"'“”‘’()（）【】\[\]—…\-~～/\\|]/g, '')

export function blankDue(take, sit = {}) {
  if (!take || take.state !== 'blank') return { due: false, why: '' }
  const rv = take.revisit || {}
  const at = String(rv.at ?? '')
  if (!at) return { due: true, why: '挂空时没给 revisit（旧账或半张定义）⇒ 按到期处理' }
  const has = (arr) => {
    if (!arr) return false
    if (arr instanceof Set) return arr.has(at)
    if (Array.isArray(arr)) return arr.includes(at)
    return false
  }
  if (rv.kind === 'evidence') {
    return has(sit.rids)
      ? { due: true, why: `证据 ${at} 已经到了 ⇒ 该回来把这块填上` }
      : { due: false, why: `等证据 ${at}` }
  }
  if (rv.kind === 'stage') {
    return has(sit.ids) ? { due: true, why: `已进行到 ${at} ⇒ 该回来把这块填上` } : { due: false, why: `等走到 ${at}` }
  }
  if (rv.kind === 'user') {
    const txt = String(sit.text ?? '')
    return txt.includes(at) ? { due: true, why: `用户提到了「${at}」⇒ 该回来把这块填上` } : { due: false, why: `等用户提到「${at}」` }
  }
  return { due: false, why: `未知触发 ${rv.kind}` }
}

export function takeTag(take) {
  const t = take || { state: NO_TAKE }
  if (t.state === 'blank') {
    const rv = t.revisit ? `·待${t.revisit.kind === 'evidence' ? '证据' : t.revisit.kind === 'stage' ? '走到' : '用户说'}${t.revisit.at}` : '·无触发'
    return `〔空·${t.scope || '?'}${rv}〕`
  }
  if (t.state === 'redef') return `〔已重定义·${String(t.why || '').slice(0, 18)}〕`
  if (t.state === 'given') return ''
  return ''
}
