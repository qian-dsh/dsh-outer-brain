
import { P_FLOOR, P_DEAD_TOP, P_MIN, P_MAX, clampP, MIN_CONTRA_FOR_CONTRACT } from './belief.mjs'
import * as OB from './obligation.mjs'

export const KINDS = ['名实不符', '开环', '口径', '欠账', '单例', '幂等', '瞬态', '未定']

export const ACTS_PRE = ['补观测', '复核']
export const ACTS_METHOD = ['降维', '升维', '转移', '取无', '平衡', '知止']
export const ACTS_DECISION = ['取舍', '重定义']
export const ACTS = [...ACTS_PRE, ...ACTS_METHOD, ...ACTS_DECISION]

export const STOP_FIELDS = ['what_left', 'stop_at', 'fire_when']

export const ACT_OWES = {
  补观测: {
    fields: ['observed', 'where'],
    say: '补观测要交"看到了什么（可复核）+ 在哪看的"。只写"我又看了一遍"不是观测，是叙述。',
  },
  复核: {
    fields: ['rerun', 'diff'],
    say: '复核要交"重跑了什么（输入/环境/版本）+ 跟上次差在哪"。两次都绿但说不出差在哪，等于只跑了一遍。',
  },
  降维: {
    fields: ['split', 'why_orthogonal'],
    say: '降维要交"拆成哪几块 + 为什么它们不重叠"。'
      + '只拆子任务不算降维（那是同层拆分，已被判为错）；要说清这几块各自管什么、边界在哪不打架。',
  },
  升维: {
    fields: [],
    say: '升维走 `brain_lift_check`：要说用哪一招（ladder/restate/separate/counter）和从谁那儿借的。',
  },
  知止: {
    fields: STOP_FIELDS,
    say: '知止要交三件套：保留哪条矛盾 / 停在哪个边界 / 什么条件下回来。',
  },
  取舍: {
    fields: ['yield_to', 'cost'],
    say: '取舍要交两样：让给谁（yield_to）+ 代价是什么（cost）—— 说不清代价的取舍不是取舍，是选了省力的那条。',
  },
  重定义: {
    fields: ['was', 'now', 'why'],
    say: '重定义要交三样：原来问的是什么（was）+ 现在改成什么（now）+ 为什么旧的不成立（why）。换说法不算 —— was 和 now 相同就拒。',
  },
  转移: {
    fields: ['transfer_to', 'rebound_when'],
    say: '转移要交两样：矛盾挪到哪（transfer_to）+ 什么条件下会反弹回来（rebound_when）。',
  },
  取无: {
    fields: ['void_from', 'new_contra'],
    say: '取无要交两样：从「无」的哪里取（void_from）+ 新变量带来的新矛盾（new_contra）。',
  },
  平衡: {
    fields: ['balance_point', 'monitor'],
    say: '平衡要交两样：平衡点在哪（balance_point）+ 谁持续监测它（monitor）—— 平衡是会破的，没人看着就等于没做。',
  },
}

export function actOwed(act, o) {
  const spec = ACT_OWES[String(act || '')]
  if (!spec) return []
  return spec.fields.filter((f) => !String(o?.[f] ?? '').trim())
}
const EMPTY_WORDS = /^(无|没有|暂无|没|none|null|n\/a|待定|以后再说|看情况)[。.\s]*$/i

const FIRE_ANCHORS = [
  /[A-Za-z]:[\\/]/,
  /\.(mjs|js|cjs|json|jsonl|md|ps1|py|yml|yaml|txt)\b/i,
  /\b[CTQM]\d{1,3}\b/,
  /\bB-[a-z][\w-]*/,
  /\b(node|npm|pnpm|pwsh|git|python|pip|curl)\b/i,
  /\bbrain_[a-z_]+\b/,
  /\b(pool|tree|plan|matrix|contra|evidence|beliefs|stall_streak|engage|ob)\b/i,
  /用户|你说|原话|我确认/,
  /第\s*\d+\s*轮|\b20\d\d-\d\d-\d\d\b/,
]
export function checkFireWhen(s) {
  const v = String(s ?? '').trim()
  if (v.length < 4 || EMPTY_WORDS.test(v)) {
    return { ok: false, anchored: false, why: 'fire_when（什么条件下必须回来）太短或只是敷衍词' }
  }
  const anchored = FIRE_ANCHORS.some((re) => re.test(v))
  return {
    ok: true, anchored,
    why: anchored ? '' : `「${v}」没有可查锚点（文件 / 节点 id / 字段 / 命令 / 用户确认 / 轮次）`
      + ' ⇒ 到期检查不会自动触发它，只能靠人回头看。',
  }
}

export function countVagueFire(tree) {
  const nodes = Object.values(tree?.nodes || {})
  const openStates = ['shelved', 'parked', 'coexisting', 'open']
  const hit = nodes.filter((n) => n && n.fire_when_vague === true && openStates.includes(String(n.status)))
  return { nodes: hit.length, ids: hit.map((n) => n.id), all: nodes.filter((n) => n?.fire_when_vague === true).length }
}

export const DEFAULT_ACT = {
  名实不符: '补观测',
  开环: '补观测',
  口径: '复核',
  欠账: '取舍',
  单例: '降维',
  幂等: '复核',
  瞬态: '知止',
  未定: '补观测',
}

export const CLIMB_MIN_ACTS = 2
export const MIN_CONTRA = MIN_CONTRA_FOR_CONTRACT

export function newContradictionTree() {
  return { seq: 0, nodes: {}, root: null, climbed: [], models: 0 }
}

function mkNode(o) {
  const p = clampP(Number(o.p ?? 0.5))
  return {
    id: o.id,
    level: o.level,
    parent: o.parent ?? null,
    weight: Number.isFinite(Number(o.weight)) ? Math.max(0, Math.min(100, Math.round(Number(o.weight)))) : null,
    statement: String(o.statement ?? ''),
    between: { a: String(o.between?.a ?? ''), b: String(o.between?.b ?? '') },
    kind: String(o.kind ?? ''),
    act: String(o.act ?? DEFAULT_ACT[o.kind] ?? ''),
    p, p_peak: p,
    hist: [{ p, at: o.at ?? null, why: 'initial' }],
    from_take: o.from_take ?? null,
    status: 'open',
    attempts: [],
    children: [],
    observed: String(o.observed ?? ''),
    created_at: o.at ?? new Date().toISOString(),
    retake_required: null,
    need_recheck: '',
  }
}

export function observeMain(tree, o) {
  if (!tree) return { ok: false, why: '无树' }
  if (tree.root) {
    return { ok: false, why: `主矛盾已存在（${tree.root}）—— 主矛盾唯一。要改它，先 climb 不了的东西只能用「共存」改写，或整棵重置` }
  }
  const a = String(o?.a ?? '').trim()
  const b = String(o?.b ?? '').trim()
  const obs = String(o?.observed ?? '').trim()
  if (!a || !b) {
    return { ok: false, why: 'C2：主矛盾必须说清**两条路径**（不是"现状/目标"）。'
      + ' a = 走这条路会得到什么结果；b = 走另一条路会得到什么结果；两者要到**同一个终点**。\n'
      + '  只写"有困难"、"缺一层"、"还没做"—— 那些不是矛盾，是**欠账**，该用 brain_plan 建成里程碑。' }
  }
  if (a === b) return { ok: false, why: 'C2：两条路径的结果一字不差 ⇒ 不存在分歧 ⇒ 这不是矛盾' }
  if (!obs) {
    return { ok: false, why: 'C1：观察在前。没写「看到了什么」（现状与目标的差距在哪个事实上体现）⇒ 这是猜的主要矛盾，不是找出来的' }
  }
  const kind = String(o?.kind ?? '').trim()
  if (kind && !KINDS.includes(kind)) {
    return { ok: false, why: `类别必须落在七类之一（${KINDS.join('/')}），收到「${kind}」—— 分类本身欠账` }
  }
  const id = 'C0'
  const n = mkNode({ id, level: 0, parent: null, weight: 100, statement: o.statement, between: { a, b },
    kind, observed: obs, p: o.p, at: o.at })
  tree.nodes[id] = n
  tree.root = id
  return { ok: true, id, node: n,
    why: `主矛盾：${a} ↔ ${b}。它不可解，只能转移成子矛盾或显式共存` }
}

export function openChild(tree, parentId, o) {
  const ob = o?.ob || null
  let obSet = null
  const parent = tree?.nodes?.[parentId]
  if (!parent) return { ok: false, why: `无此父矛盾 ${parentId}` }
  if (parent.status === 'fake') return { ok: false, why: `${parentId} 已判伪矛盾，不能在伪矛盾下开子矛盾` }

  const from = o?.from
  if (!from || (!from.assumption && !from.belief_id)) {
    return { ok: false, why: 'C4：子矛盾必须指出出处（from.belief_id / from.assumption）—— 说不出是哪次「取」把它生出来的，就是凭空造矛盾' }
  }
  if (!String(o?.observed ?? '').trim()) {
    return { ok: false, why: 'C1：开子矛盾同样要「观察在前」—— 写清在哪个事实上看到了这个边界' }
  }
  const kind = String(o?.kind ?? '').trim()
  if (!KINDS.includes(kind)) {
    return { ok: false, why: `类别必须落在七类之一（${KINDS.join('/')}），收到「${kind}」` }
  }

  const rr = parent.retake_required
  if (rr) {
    const m = o?.model
    if (!m) {
      return { ok: false, why: `${parentId} 已被要求重新定义再取（上次的边界「${rr.retract?.boundary || '-'}」判错了）。`
        + 'C5：必须在 model 里写清新模型（vars / boundary / criterion / predict），否则是原地重来' }
    }
    const bound = String(m.boundary ?? '').trim()
    if (!bound) return { ok: false, why: '重取必须下边界（model.boundary）—— 不下边界等于没取' }
    if (bound === String(rr.retract?.boundary ?? '')) {
      return { ok: false, why: `新边界与判错的那次相同（「${bound}」）⇒ 这是「执」，不是「取」。新模型必须换掉那条边界` }
    }
    const oldVars = new Set(rr.model_vars || [])
    const nv = (m.vars || []).filter((v) => !oldVars.has(v))
    if (!nv.length) {
      return { ok: false, why: `model.vars 全部落在旧变量集里（${(m.vars || []).join('/') || '空'}）⇒ 集合减法为空 ⇒ 换说法没换层` }
    }
    if (!String(m.criterion ?? '').trim()) return { ok: false, why: '重取必须给判据（model.criterion）：新层上什么算解决' }
    if (!m.predict) return { ok: false, why: '重取必须给可证伪预测（model.predict）—— 否则新层不可检验' }
  }

  tree.seq += 1
  const id = `C${tree.seq}`
  const wRaw = Number(o?.weight)
  const w = Number.isFinite(wRaw) ? Math.max(0, Math.min(100, Math.round(wRaw))) : (parent.weight ?? null)
  const n = mkNode({
    id, level: parent.level + 1, parent: parentId, weight: w,
    statement: o.statement, between: o.between, kind, observed: o.observed, p: o.p, at: o.at,
    from_take: {
      belief_id: from.belief_id ?? null,
      assumption: String(from.assumption ?? ''),
      boundary: String(o?.model?.boundary ?? rr?.retract?.boundary ?? ''),
    },
  })
  if (o?.model) {
    n.model = o.model
    tree.models += 1
    if (rr) {
      rr.resolved_at = new Date().toISOString()
      rr.resolved_by = id
      parent.retake_required = null
      obSet = OB.settleWhere(ob, parentId, { how: `用 ${id} 的模型重取（新边界「${o.model.boundary}」）` })
    }
  }
  tree.nodes[id] = n
  parent.children.push(id)
  const opened = ob ? OB.openOb(ob, {
    kind: 'evidence', at: id,
    what: `为 ${id}（${n.statement.slice(0, 24)}）交一条能判它成不成立的证据`,
    opened_seq: o?.opened_seq,
    scope: nodeScope(tree, id),
    ...(from?.belief_id ? { from: String(from.belief_id) } : {}),
  }) : null
  return { ok: true, id, node: n,
    ob: opened?.ok ? opened.id : null,
    ...(obSet && obSet.n ? { obRetakeSettled: obSet.n } : {}),
    why: `L${n.level} 子矛盾「${n.statement}」—— 由 ${from.belief_id || '?'} 的假设「${from.assumption || '-'}」推出` }
}

export function trySolve(tree, id, o) {
  const n = tree?.nodes?.[id]
  if (!n) return { ok: false, why: `无此矛盾 ${id}` }
  if (n.level === 0) {
    return { ok: false, why: 'C3：L0（我与目标之间）不可解 —— 能改的只有中间的路。它的合法出口只有「转移」（开子矛盾）或「共存」（写代价与期限）' }
  }
  if (n.status !== 'open') return { ok: false, why: `${id} 状态为 ${n.status}，不再接受尝试` }
  const act = String(o?.act ?? '').trim()
  if (!ACTS.includes(act)) return { ok: false, why: `手法必须落在六种之一（${ACTS.join('/')}），收到「${act}」` }
  if (!String(o?.why ?? '').trim()) return { ok: false, why: '试了要写凭什么这么试（why）' }
  const resolved = !!o?.resolved
  if (resolved && !String(o?.evidence ?? '').trim()) {
    return { ok: false, why: '宣称解决了必须给证据（evidence：怎么验的/在哪能看到）。无回执的"已解决"不收' }
  }

  if (act === '知止') {
    if (resolved) {
      return { ok: false, why: '「知止」是停手，不是解决 —— 不许带 resolved。'
        + '真解掉了就用对应手法（补观测/复核/…）并给回执' }
    }
    const miss = []
    const wl = String(o?.what_left ?? '').trim()
    const sa = String(o?.stop_at ?? '').trim()
    const fw = String(o?.fire_when ?? '').trim()
    if (wl.length < 4 || EMPTY_WORDS.test(wl)) miss.push('what_left（保留了哪条矛盾——写"无"等于没有停手理由）')
    if (sa.length < 4 || EMPTY_WORDS.test(sa)) miss.push('stop_at（停在哪个边界上："够了"的适用范围）')
    const fwChk = checkFireWhen(fw)
    if (!fwChk.ok) miss.push('fire_when（什么条件下必须回来：边界失效的判据）')
    if (miss.length) {
      return { ok: false, why: `「知止」必须当场付清三件套，缺 ${miss.length} 项：${miss.join('；')}。`
        + '取到合适就不取了 —— 但"合适"是一次取，下了边界就得说清边界外是什么。' }
    }
    const vague = !fwChk.anchored
    n.attempts.push({
      act, why: String(o.why), evidence: '', resolved: false,
      at: o.at ?? new Date().toISOString(),
      what_left: wl, stop_at: sa, fire_when: fw,
      fire_when_vague: vague,
    })
    n.status = 'shelved'
    n.shelved_at = new Date().toISOString()
    n.need_recheck = fw
    n.fire_when_vague = vague
    n.stop_at = sa
    n.what_left = wl
    n.hist.push({ p: n.p, at: n.shelved_at, why: `知止于「${sa}」：保留 ${wl}；回来条件 ${fw}` })
    return {
      ok: true, closed: false, shelved: true,
      why: `${id} 知止：停在「${sa}」，保留「${wl}」，回来条件「${fw}」—— 已转隐患账`
        + (vague ? `\n⚠️ ${fwChk.why}` : ''),
      hazard: {
        from: id,
        what: `知止保留：${wl}`,
        where: `停在「${sa}」（这次取的下边界之外）`,
        fire_when: fw,
        fire_when_vague: vague,
        assumption: String(n.from_take?.assumption ?? ''),
      },
    }
  }

  if (act === '重定义') {
    const was = String(o?.was ?? '').trim()
    const now = String(o?.now ?? '').trim()
    const whyR = String(o?.why ?? '').trim()
    const miss = []
    if (was.length < 4) miss.push('was（原来把它当什么问题）')
    if (now.length < 4) miss.push('now（现在把它当什么问题）')
    if (whyR.length < 6) miss.push('why（为什么旧定义站不住，≥6 字）')
    if (was && now && was === now) miss.push('was 与 now 相同 ⇒ 那是换说法，不是重新定义')
    if (miss.length) {
      return { ok: false, why: `「重定义」必须交三件，缺 ${miss.length} 项：${miss.join('；')}。`
        + '重新定义是「取」，取就要说清边界换了什么 —— 说不出，就还是在旧问题里打转。' }
    }
    const at = o.at ?? new Date().toISOString()
    n.attempts.push({ act, why: whyR, was, now, resolved: true, at })
    n.status = 'solved'
    n.redefined = { was, now, why: whyR, at }
    n.hist.push({ p: n.p, at, why: `重定义：${was} → ${now}` })
    return {
      ok: true, closed: true, redefined: { was, now, why: whyR },
      why: `${id} 重定义：原来当「${was}」，现在当「${now}」。旧问题不成立 ⇒ 它欠的债一并销账（不是"还上了"）。`,
    }
  }

  const owed = actOwed(act, o)
  const goods = {}
  const spec = ACT_OWES[act]
  if (spec) {
    for (const f of spec.fields) {
      const v = String(o?.[f] ?? '').trim()
      if (v) goods[f] = v
    }
  }
  n.attempts.push({
    act, why: String(o.why), evidence: String(o.evidence ?? ''),
    resolved, at: o.at ?? new Date().toISOString(),
    ...(Object.keys(goods).length ? { goods } : {}),
    ...(owed.length ? { owed } : {}),
  })
  if (resolved) {
    n.status = 'solved'
    const st = o?.ob ? OB.settleWhere(o.ob, id, {
      how: `「${act}」解决：${String(o.evidence).slice(0, 80)}`,
      closed_seq: o?.closed_seq,
    }) : null
    return {
      ok: true, closed: true,
      ...(st && st.n ? { obSettled: st.n } : {}),
      why: `${id} 经「${act}」解决（证据：${String(o.evidence).slice(0, 40)}）`
        + (st && st.n ? `；义务账还了 ${st.n} 条` : ''),
    }
  }
  return { ok: true, closed: false, why: `${id} 记一次「${act}」尝试，未解。已试 ${new Set(n.attempts.map((a) => a.act)).size} 种手法` }
}

export function canClimb(n) {
  if (!n) return { ok: false, why: '无节点' }
  if (n.level === 0) return { ok: false, why: 'L0 不能上爬（没有上一层）' }
  const acts = new Set(n.attempts.map((a) => a.act))
  const def = DEFAULT_ACT[n.kind]
  if (acts.size < CLIMB_MIN_ACTS) {
    return { ok: false, why: `只试过 ${acts.size} 种手法（${[...acts].join('/') || '无'}）⇒ 先在本层解，别一遇困难就往上爬` }
  }
  if (def && !acts.has(def)) {
    return { ok: false, why: `本类矛盾（${n.kind}）的默认手法是「${def}」，你还没试过它 ⇒ 上爬无效` }
  }
  if (n.attempts.some((a) => a.resolved)) return { ok: false, why: '已有 resolved 的尝试，无需上爬' }
  const paidActs = new Set(n.attempts.filter((a) => !(a.owed || []).length).map((a) => a.act))
  const unpaid = [...acts].filter((a) => !paidActs.has(a))
  if (unpaid.length) {
    const miss = unpaid.map((a) => {
      const spec = ACT_OWES[a]
      const fields = spec ? spec.fields.join('+') : '产物'
      return `${a} 欠 ${fields}`
    })
    return {
      ok: false,
      why: `手法「${unpaid.join('、')}」只是说了一句"我试过了"，没交出它欠的东西（${miss.join('；')}）⇒ 上爬无效。`
        + '六种做法各自欠什么见 `ACT_OWES`：补观测欠 observed+where（看到了什么/在哪看的），'
        + '复核欠 rerun+diff（重跑了什么/跟上次差在哪），取舍欠 yield_to+cost（让给谁/代价）。'
        + '补交一次交齐的同名手法即可，不必把旧账删掉。',
    }
  }
  if ((n.p ?? 0.5) < P_FLOOR) {
    return { ok: false, why: `p=${Number(n.p).toFixed(3)} 已跌破地板 ⇒ 这条矛盾多半是伪矛盾。走 markFake，不要拿它当上爬的理由` }
  }
  return { ok: true, why: `已试 ${[...acts].join('/')} 共 ${n.attempts.length} 次，均无果；p=${Number(n.p).toFixed(3)} 仍站得住` }
}

export function climb(tree, id, o = {}) {
  const n = tree?.nodes?.[id]
  const g = canClimb(n)
  if (!g.ok) return { ok: false, why: g.why }
  const parent = tree.nodes[n.parent]
  if (!parent) return { ok: false, why: `父节点 ${n.parent} 缺失（树被改坏）` }
  if (!String(o.why ?? '').trim()) return { ok: false, why: '上爬必须写清凭什么（why）' }

  n.status = 'parked'
  n.parked_at = new Date().toISOString()
  n.climb_why = String(o.why)
  n.climbed_to = parent.id
  n.need_recheck = String(o.recheck_when ?? '')
  n.hist.push({ p: n.p, at: n.parked_at, why: `回到上一层 ${parent.id}：${o.why}` })

  const retract = n.from_take || {}
  parent.retake_required = {
    at: n.parked_at,
    why: String(o.why),
    child: id,
    retract,
    model_vars: Array.isArray(n.model?.vars) ? n.model.vars : [],
    forbid_boundary: retract.boundary || '',
  }
  tree.climbed.push({ id, to: parent.id, why: String(o.why), at: n.parked_at })

  const retake = o?.ob ? OB.openOb(o.ob, {
    kind: 'retake', at: parent.id,
    what: `${parent.id} 欠一次重取：换掉边界「${retract.boundary || '-'}」、变量集要真扩张`,
    opened_seq: o?.opened_seq,
    scope: nodeScope(tree, parent.id),
    from: id,
  }) : null
  const absorbed = (o?.ob && retake?.ok) ? OB.absorbWhere(o.ob, id, {
    by: retake.id,
    why: `${id} 回到上一层 ${parent.id} 重新定义 ⇒ 这条证据义务由 ${retake.id}（父层重取）承接；`
      + '旧层那条问题没有消失，它现在是整体里的一部分',
    closed_seq: o?.closed_seq,
  }) : null

  return {
    ok: true,
    id, parked: id, back_to: parent.id,
    retract,
    ...(absorbed && absorbed.n ? { obAbsorbed: absorbed.n, obBy: retake?.id ?? null } : {}),
    ...(retake?.ok ? { obRetake: retake.id } : {}),
    must: [
      '重新定义矛盾（父层的 statement 可能因此改写）',
      `不许再用被作废的边界「${retract.boundary || '-'}」`,
      '写清 model：vars（新增了什么变量）/ boundary / criterion / predict',
      '在 model 下再开一条子矛盾（openChild 带 model），而不是把本条改个说法交回去',
    ],
    why: `${id} 在本层无解（${g.why}）⇒ 回到 L${parent.level} ${parent.id} 重新定义再取`
      + (absorbed && absorbed.n
        ? `；${id} 名下 ${absorbed.n} 条取证义务被 ${retake?.id} **承接**（不是销掉：那条问题还在，只是归上层管）`
        : '')
      + (retake?.ok ? `；${parent.id} 名下新开 ${retake.id}（欠一次重取）` : ''),
  }
}

export function markFake(tree, id, o = {}) {
  const n = tree?.nodes?.[id]
  if (!n) return { ok: false, why: `无此矛盾 ${id}` }
  const p = Number(o.p ?? n.p)
  n.p = clampP(p)
  n.p_peak = Math.max(n.p_peak, n.p)
  n.n_contra = Number(o.n_contra ?? n.n_contra ?? 0)
  if (!(n.p < P_FLOOR && n.p_peak >= P_DEAD_TOP && n.n_contra >= MIN_CONTRA)) {
    return { ok: false, why: `判伪需三条同时：p<${P_FLOOR}（现 ${n.p.toFixed(3)}）∧ 曾达≥${P_DEAD_TOP}（现 ${n.p_peak.toFixed(3)}）∧ 反证≥${MIN_CONTRA}（现 ${n.n_contra || 0}）` }
  }
  n.status = 'fake'
  n.fake_why = String(o.why ?? '')
  const vd = o?.ob ? OB.voidWhere(o.ob, id, {
    kind: 'fake',
    why: `${id} 判伪：曾达 ${n.p_peak.toFixed(2)} 后被 ${n.n_contra} 票反证压到 ${n.p.toFixed(2)}，它不是真矛盾`,
    closed_seq: o?.closed_seq,
  }) : null
  return {
    ok: true, id,
    ...(vd && vd.n ? { obVoided: vd.n } : {}),
    why: `${id} 判伪：曾达 ${n.p_peak.toFixed(2)} 后被 ${n.n_contra} 票反证压到 ${n.p.toFixed(2)}，它不是真矛盾`
      + (vd && vd.n ? `；${vd.n} 条取证义务已销（不是还上了：这条债本就不该开）` : ''),
  }
}

export function coexist(tree, id, o = {}) {
  const n = tree?.nodes?.[id]
  if (!n) return { ok: false, why: `无此矛盾 ${id}` }
  if (n.level !== 0) return { ok: false, why: '只有 L0 可以「共存」；子矛盾要么解、要么上爬、要么判伪' }
  if (!o.cost || !o.until) return { ok: false, why: '共存必须写代价（cost）与期限（until）—— 没代价的"接受"就是装作不存在' }
  n.status = 'coexisting'
  n.coexist = { cost: String(o.cost), until: String(o.until), at: new Date().toISOString() }
  return {
    ok: true, id,
    why: `主矛盾转为共存（代价 ${o.cost}，至 ${o.until}）`,
    hazard: {
      from: id,
      what: `共存：${n.statement || '主矛盾'}（我 ↔ 目标）`,
      where: `永久欠账 —— L0 不可解，只能转移；当前代价「${o.cost}」`,
      fire_when: String(o.until),
      assumption: '这条落差可以带着走',
    },
  }
}

export function dissolveNode(tree, id, { verdict, note = '', to = null, at = null } = {}) {
  const n = tree?.nodes?.[String(id)]
  if (!n) return { ok: false, why: `矛盾节点 ${id} 不存在（现有：${Object.keys(tree?.nodes || {}).join(' / ') || '无'}）` }
  const v = String(verdict || '')
  if (!['dissolved', 'transformed', 'still'].includes(v)) {
    return { ok: false, why: 'verdict 必须是 dissolved / transformed / still 之一（给不出就不算回执）' }
  }
  if (v === 'transformed' && !String(to || '').trim()) {
    return { ok: false, why: 'transformed（矛盾换位置）必须给 to（去了哪）—— 不记去向，它必反弹回来' }
  }
  if (v === 'still') {
    n.lift_still = { at: at || new Date().toISOString(), note: String(note || '').slice(0, 200) }
    return { ok: true, id: String(id), verdict: v,
      why: '记下了：这次升维是「执」（旧矛盾在新层下仍成立）—— 要真取，得换边界/加变量/给判据' }
  }
  n.dissolved = {
    verdict: v,
    note: String(note || '').slice(0, 300),
    to: v === 'transformed' ? String(to).slice(0, 120) : null,
    at: at || new Date().toISOString(),
  }
  if (v === 'dissolved') n.status = 'solved'
  return { ok: true, id: String(id), verdict: v, status: n.status, to: n.dissolved.to }
}

export function revive(tree, id, o = {}) {
  const n = tree?.nodes?.[id]
  if (!n) return { ok: false, why: `无此矛盾 ${id}` }
  if (n.status !== 'shelved' && n.status !== 'parked') {
    return { ok: false, why: `${id} 状态为 ${n.status}，只有 shelved/parked 可以被隐患拉回` }
  }
  const from = n.status
  n.status = 'open'
  n.revived_at = new Date().toISOString()
  n.revived_from = from
  n.revive_why = String(o.why ?? '隐患复发')
  n.hist.push({ p: n.p, at: n.revived_at, why: `隐患复发 ⇒ 从 ${from} 拉回 open：${o.why ?? ''}` })
  const parent = tree.nodes[n.parent]
  if (parent) {
    parent.retake_required = {
      at: n.revived_at,
      why: `子矛盾 ${id} 知止的边界失效（${o.why ?? '隐患复发'}）`,
      child: id,
      retract: n.from_take || {},
      model_vars: Array.isArray(n.model?.vars) ? n.model.vars : [],
      forbid_boundary: String(n.stop_at ?? n.from_take?.boundary ?? ''),
    }
  }
  return {
    ok: true, id, back_to: 'open', from,
    why: `${id} 由隐患拉回 open（原 ${from}）⇒ 停在「${n.stop_at || '-'}」这个判断失效，回到空重取`,
  }
}

export function deepestOpen(tree) {
  const all = Object.values(tree?.nodes ?? {}).filter((n) => n.status === 'open' && n.level > 0)
  if (!all.length) return null
  return all.sort((a, b) => (b.level - a.level) || (b.p - a.p))[0]
}

export function climbReady(tree) {
  return Object.values(tree?.nodes ?? {})
    .filter((n) => n.status === 'open' && n.level > 0)
    .map((n) => ({ n, g: canClimb(n) }))
    .filter((x) => x.g.ok)
}

export function nodeScope(tree, id) {
  const n = tree?.nodes?.[String(id)]
  if (!n) return null
  const kids = Object.values(tree.nodes || {}).filter((x) => x.parent === String(id))
  let deepest = Number(n.level) || 0
  let count = 1
  const walk = (pid) => {
    for (const k of Object.values(tree.nodes || {}).filter((x) => x.parent === pid)) {
      count += 1
      deepest = Math.max(deepest, Number(k.level) || 0)
      walk(k.id)
    }
  }
  walk(String(id))
  return {
    from: Number(n.level) || 0,
    to: deepest,
    n: count,
    kids: kids.length,
    id: String(id),
  }
}

export function contraSummary(tree) {
  const nodes = Object.values(tree?.nodes ?? {})
  const kids = nodes.filter((n) => n.level > 0)
  const by = { open: 0, parked: 0, fake: 0, solved: 0, coexisting: 0, shelved: 0 }
  for (const n of kids) by[n.status] = (by[n.status] || 0) + 1
  {
    const rootNode = tree?.root ? (tree.nodes || {})[tree.root] : null
    if (rootNode && rootNode.status === 'coexisting') by.coexisting += 1
  }
  const maxLevel = nodes.reduce((m, n) => Math.max(m, n.level), 0)
  return {
    root: tree?.root ?? null,
    root_status: tree?.root ? tree.nodes[tree.root]?.status : null,
    total: nodes.length,
    ...by,
    maxLevel,
    climbed: (tree?.climbed || []).length,
    models: tree?.models || 0,
    retake_pending: nodes.filter((n) => n.retake_required).map((n) => n.id),
  }
}

export function renderContra(tree, limit = 12, ob = null) {
  const s = contraSummary(tree)
  if (!s.root) {
    return ['【矛盾树】空 —— 还没有主矛盾。第一件事是**观察**：我在哪、目标在哪、差在哪个事实上，然后 observeMain。']
  }
  const out = [`【矛盾树】主矛盾 ${s.root}；节点 ${s.total}（open ${s.open} / parked ${s.parked} / shelved ${s.shelved} / fake ${s.fake} / coexisting ${s.coexisting}）；最深 L${s.maxLevel}`]
  const walk = (id, d) => {
    const n = tree.nodes[id]
    if (!n || d > limit) return
    const flag = n.status === 'open' ? '' : `[${n.status}]`
    const rq = n.retake_required ? ' ⚠️须重定义再取' : ''
    const obIds = ob ? OB.owedBy(ob, id).map((x) => `${x.id}(${x.kind})`) : []
    const obTag = obIds.length ? ` 〔欠 ${obIds.join('、')}〕` : ''
    const rootTag = n.level > 0 ? ' →根 ' + s.root : ''
    const wTag = n.weight !== undefined && n.weight !== null ? ' w=' + n.weight : ''
    out.push(`${'  '.repeat(d)}${n.id} L${n.level}${rootTag} ${n.kind || '?'}${flag}${rq} p=${n.p.toFixed(2)}${wTag}${obTag} ${String(n.statement).slice(0, 40)}`)
    if (n.status === 'shelved') {
      out.push(`${'  '.repeat(d + 1)}└ 知止于「${n.stop_at || '-'}」；保留 ${n.what_left || '-'}；回来条件「${n.need_recheck || '-'}」`)
    }
    if (n.retake_required) {
      out.push(`${'  '.repeat(d + 1)}└ 上次边界「${n.retake_required.forbid_boundary || '-'}」作废；新取必须换边界、加变量`)
    }
    for (const c of n.children) walk(c, d + 1)
  }
  walk(s.root, 0)
  if (s.retake_pending.length) out.push(`⇒ 待重取：${s.retake_pending.join('、')}`)
  const ln = OB.obLine(ob)
  if (ln) out.push(ln)
  const { lights } = OB.obLights(ob)
  for (const l of lights) out.push(l)
  return out
}
