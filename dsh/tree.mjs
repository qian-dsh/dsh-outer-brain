
export const TASK_WEIGHT = 100
export const TASK_ORIGIN = ['user', 'ledger', 'self']

export function looksLikeCommand(text, lastUserText) {
  const t = String(text || '').trim()
  const u = String(lastUserText || '').trim()
  if (!t || !u) return false
  const hasTaskVerb = /(做|写|改|查|修|跑|建|给|帮|实现|验证|分析|整理)/.test(t)
  if (hasTaskVerb) return false
  const compact = t.replace(/[\s。.!！,，、]/g, '')
  if (compact.length > 12) return false
  return u.includes(compact) || compact.includes(u.replace(/[\s。.!！,，、]/g, ''))
}
export const QUESTION_WEIGHT = 50
export const CRITICAL_BONUS = 2
export const ROOT_BUDGET = 300
export const GONE_STATUSES = ['invalid', 'dissolved', 'transformed']

const openOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function pressure(tree, parentId, nowSeq = null) {
  const numOrNull = (v) => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const seqNow = numOrNull(nowSeq)
  const spentOf = (node) => {
    if (node === null) return seqNow
    const o = numOrNull(node?.opened_seq)
    if (seqNow === null || o === null) return null
    return Math.max(0, seqNow - o)
  }
  const pid = parentId === null || parentId === undefined ? null : String(parentId)
  const parent = pid === null ? null : (tree?.tasks?.[pid] || tree?.questions?.[pid] || null)
  if (pid === null) {
    const ts = Object.values(tree?.tasks || {}).filter((t) => t.id !== META_ID && t.status !== 'superseded' && t.status !== 'invalid')
    const cap = Number(tree?.budget) > 0 ? Number(tree.budget) : ROOT_BUDGET
    const used = ts.reduce((a, t) => a + (Number(t.weight) || 0), 0)
    return { parent: 'L0', cap, used, left: cap - used, enforced: true, kids: ts.map((t) => t.id),
      allocated: used, spent: spentOf(null), seq_now: seqNow }
  }
  const cap = Number(parent?.weight) || 0
  const kids = Object.values(tree?.questions || {}).filter((q) => q.parent === pid)
    .filter((q) => !GONE_STATUSES.includes(q.status) && q.status !== 'superseded')
  const used = kids.reduce((a, q) => a + (Number(q.weight) || 0), 0)
  return { parent: pid, cap, used, left: cap - used, enforced: true, kids: kids.map((q) => q.id),
    allocated: used, spent: spentOf(parent), seq_now: seqNow }
}

export function newTree(root = null, budget = ROOT_BUDGET) {
  return {
    root,
    budget: Number(budget) > 0 ? Number(budget) : ROOT_BUDGET,
    tasks: {},
    questions: {},
    back_log: [],
  }
}

function now() {
  return new Date().toISOString()
}

const PARAPHRASE_MARKS = ['追问', '补充授权', '他说', '第二句', '用户同意', '经用户确认', '授权你自己', '自选', '选项下', '由他选择']

const compactText = (s) => String(s || '').replace(/[\s。.!！,，、；;：:（）()【】\[\]"'“”‘’]/g, '')

export function longestCommon(a, b) {
  const A = compactText(a)
  const B = compactText(b)
  if (!A || !B) return 0
  let best = 0
  const dp = new Array(B.length + 1).fill(0)
  for (let i = 1; i <= A.length; i++) {
    let prev = 0
    for (let j = 1; j <= B.length; j++) {
      const cur = dp[j]
      dp[j] = A[i - 1] === B[j - 1] ? prev + 1 : 0
      if (dp[j] > best) best = dp[j]
      prev = cur
    }
  }
  return best
}

export function looksOffTopic(text, lastUserText) {
  const t = String(text || '').trim()
  const u = String(lastUserText || '').trim()
  if (!t || !u) return { off: false, why: '' }
  const tc = compactText(t)
  const uc = compactText(u)
  if (!uc) return { off: false, why: '' }
  if (uc.length <= 12) {
    if (tc.includes(uc)) return { off: false, why: '' }
    return { off: true, why: `用户原话只有 ${uc.length} 字（「${u}」），但任务文本里找不到它 —— 这不是他说的那句话` }
  }
  const lc = longestCommon(t, u)
  if (lc >= 6) return { off: false, why: '' }
  return { off: true, why: `任务文本与原话的最长公共片段只有 ${lc} 字（原话 ${uc.length} 字）—— 基本是另写了一段` }
}
export function checkTaskText(text, lastUserText) {
  const t = String(text || '')
  const u = String(lastUserText || '')
  if (!u) return { suspect: false, hits: [], why: '本会话还没有用户原话可比（未核，不判编造）' }
  const hits = PARAPHRASE_MARKS.filter((w) => t.includes(w) && !u.includes(w))
  if (!hits.length) return { suspect: false, hits: [], why: '' }
  return { suspect: true, hits, why: `text 里出现用户没说过的话：${hits.join('、')}` }
}

export function declareTask(tree, { id, text, deps = [], weight = TASK_WEIGHT, order = null,
  conflicts = [], yield_to = null, cost = null, seq = null,
  reading = null, because = null, want = null, wants = null, origin = null,
  contradiction = null,
  textSuspect = false, textIsCommand = false, textOfftopic = false }) {
  if (!tree) tree = newTree()
  const tid = String(id)
  if (!text) return { ok: false, why: '任务必须有 text（用户的话）' }
  const w = Number(weight) || TASK_WEIGHT
  if (w < TASK_WEIGHT && tid !== META_ID && (!yield_to || !cost)) {
    return { ok: false, why:
      `任务 ${tid} 权重 ${w} < ${TASK_WEIGHT}（满额）⇒ 这是一次让步，必须写清 yield_to（让给哪条）与 cost（代价）。\n`
      + `无代价的降权 = 悄悄把它降级，等于没做取舍 —— 这正是「用户要求之间的矛盾」被藏起来的样子。` }
  }
  for (const c of (conflicts || []).map(String)) {
    if (c === tid) return { ok: false, why: `任务 ${tid} 不能与自己冲突` }
    const other = tree.tasks[c]
    if (other && Number(other.weight) >= TASK_WEIGHT && w >= TASK_WEIGHT) {
      return { ok: false, why:
        `${tid} 与 ${c} 声明互相冲突，但两条都满额（${TASK_WEIGHT}）⇒ 冲突被藏了。\n`
        + `必然有一条要让位：给出 yield_to + cost 把它降下来，或明确说"这两条我分不出主次，请裁决"。` }
    }
  }
  const prev = tree.tasks[tid]
  const node = {
    id: tid,
    text: String(text),
    weight: w,
    deps: [...(deps || [])].map(String),
    conflicts: [...(conflicts || [])].map(String),
    yield_to: yield_to === null || yield_to === undefined ? (prev ? prev.yield_to : null) : String(yield_to),
    cost: cost === null || cost === undefined ? (prev ? prev.cost : null) : String(cost),
    order: order === null ? (prev ? prev.order : Object.keys(tree.tasks).length) : Number(order),
    reading: reading === null || reading === undefined
      ? (prev ? (prev.reading ?? null) : null) : String(reading).trim(),
    because: because === null || because === undefined
      ? (prev ? (prev.because ?? null) : null) : String(because).trim(),
    want: want === null || want === undefined
      ? (prev ? (prev.want ?? null) : null) : String(want).trim(),
    contradiction: contradiction === null || contradiction === undefined
      ? (prev ? (prev.contradiction ?? null) : null) : String(contradiction).trim(),
    wants: (() => {
      if (Array.isArray(wants) && wants.length) {
        const out = []
        for (let i = 0; i < wants.length; i++) {
          const x = wants[i] || {}
          const t = String(x.text ?? '').trim()
          if (!t) continue
          const wv = Number(x.weight)
          out.push({
            id: String(x.id || `W${out.length + 1}`),
            text: t.slice(0, 300),
            weight: Number.isFinite(wv) ? Math.max(0, Math.min(100, Math.round(wv))) : null,
            parent: x.parent ? String(x.parent) : null,
          })
        }
        return out
      }
      return prev && Array.isArray(prev.wants) ? prev.wants : []
    })(),
    status: prev ? prev.status : 'active',
    need_retake: prev ? prev.need_retake : false,
    text_suspect: textSuspect === true || (prev ? prev.text_suspect === true : false),
    text_is_command: textIsCommand === true,
    text_offtopic: textOfftopic === true,
    origin: (() => {
      const raw = origin === null || origin === undefined ? '' : String(origin).trim()
      if (TASK_ORIGIN.includes(raw)) return raw
      return prev && TASK_ORIGIN.includes(String(prev.origin || '')) ? String(prev.origin) : 'undefined'
    })(),
    opened_seq: openOrNull(prev && prev.opened_seq) ?? openOrNull(seq),
    created_at: prev ? prev.created_at : now(),
    updated_at: now(),
  }
  tree.tasks[tid] = node
  return { ok: true, id: tid, node, weight: node.weight }
}

export function takeQuestion(tree, { id, parent, text, why, weight = null, critical = false, seq = null }) {
  if (!tree) tree = newTree()
  const qid = String(id)
  const pid = parent === undefined || parent === null ? null : String(parent)
  if (!why) return { ok: false, why: `子问题 ${qid} 缺 why（取的理由）—— 取的理由就是权重，缺它拒收` }
  if (pid !== null && !tree.tasks[pid] && !tree.questions[pid]) {
    return { ok: false, why: `父节点 ${pid} 不存在 —— 子问题不能挂悬空` }
  }
  const prev = tree.questions[qid]
  const acct = pressure(tree, pid)
  const auto = acct.cap
    ? Math.max(1, Math.round((acct.left > 0 ? acct.left : 0) / 2))
    : QUESTION_WEIGHT
  const base = weight === null || weight === undefined ? auto : Number(weight)
  if (!(base > 0)) return { ok: false, why: `权重必须是正数（拿到 ${weight}）—— 0 权重 = 不必取，不该进树` }
  const finalWeight = Math.round(base * (critical ? CRITICAL_BONUS : 1))
  if (acct.enforced) {
    const back = prev ? Number(prev.weight) || 0 : 0
    const left = acct.left + back
    if (finalWeight > left) {
      return { ok: false, why:
        `压力超额：${acct.parent} 的额度 ${acct.cap}（已分 ${acct.used}，余 ${left}），这条要 ${finalWeight}。\n`
        + `取即下边界 —— 分出去的部分不能比父还多。要么把 weight 降到 ≤ ${Math.max(0, left)}，`
        + `要么先说清从已取的 [${acct.kids.join(',') || '无'}] 里砍谁、砍多少（那是一次取舍），再取这条。` }
    }
  }
  const node = {
    id: qid,
    parent: pid,
    text: String(text || ''),
    why: String(why),
    weight: finalWeight,
    critical: !!critical,
    status: prev ? prev.status : 'active',
    rids: prev ? (prev.rids || []) : [],
    children: prev ? (prev.children || []) : [],
    opened_seq: openOrNull(prev && prev.opened_seq) ?? openOrNull(seq),
    created_at: prev ? prev.created_at : now(),
    updated_at: now(),
  }
  tree.questions[qid] = node
  if (pid !== null) {
    const p = tree.tasks[pid] || tree.questions[pid]
    if (p) {
      if (!p.children) p.children = []
      if (!p.children.includes(qid)) p.children.push(qid)
    }
  }
  return {
    ok: true, id: qid, node, weight: finalWeight, pressure: pressure(tree, pid),
    parent_signals: pid === null ? null : nodeSignals(tree.tasks[pid] || tree.questions[pid]),
  }
}

export function deriveQuestion(tree, { id, parent, text, why, weight = null, critical = false, seq = null }) {
  const pid = parent === undefined || parent === null ? null : String(parent)
  if (pid === null) return { ok: false, why: 'derive 必须给 parent（派生子问题挂到哪个父问题下）' }
  if (!tree?.questions?.[pid]) return { ok: false, why: `父问题 ${pid} 不存在 —— 派生不能挂悬空` }
  return takeQuestion(tree, { id, parent: pid, text, why, weight, critical, seq })
}

export function linkRid(tree, qid, rid) {
  const q = tree?.questions?.[qid] || tree?.tasks?.[qid]
  if (!q) return { ok: false, why: `节点 ${qid} 不存在（既非子问题也非任务）` }
  const r = String(rid)
  if (!q.rids) q.rids = []
  if (!q.rids.includes(r)) q.rids.push(r)
  q.updated_at = now()
  return { ok: true, rids: q.rids }
}

export const EV_SIGNS = ['plus', 'minus', 'zero']

export function markSign(tree, qid, rid, sign) {
  if (!EV_SIGNS.includes(sign)) return { ok: false, why: `符号只收 ${EV_SIGNS.join('/')}（拿到 ${sign}）` }
  const q = tree?.questions?.[String(qid)] || tree?.tasks?.[String(qid)]
  if (!q) return { ok: false, why: `节点 ${qid} 不存在` }
  if (!q.ev) q.ev = { plus: 0, minus: 0, zero: 0 }
  if (!q.ev_rids) q.ev_rids = []
  if (q.ev_rids.includes(String(rid))) return { ok: true, dup: true, ev: q.ev }
  q.ev_rids.push(String(rid))
  q.ev[sign] = (q.ev[sign] || 0) + 1
  q.updated_at = now()
  return { ok: true, ev: q.ev }
}

export function nodeSignals(node) {
  const ev = node?.ev || { plus: 0, minus: 0, zero: 0 }
  const plus = Number(ev.plus) || 0
  const minus = Number(ev.minus) || 0
  const zero = Number(ev.zero) || 0
  return { plus, minus, zero, net: plus - minus, total: plus + minus + zero }
}

export function evTag(node) {
  const s = nodeSignals(node)
  if (!s.total) return ''
  return ` 〔证据 +${s.plus}/−${s.minus}${s.zero ? `/0:${s.zero}` : ''}〕`
}

export function inferQid(tree, rid) {
  const m = /^(?:ANS|OBS)-([^-]+)-/.exec(String(rid || ''))
  if (!m) return null
  const cand = m[1]
  return (tree?.questions?.[cand] || tree?.tasks?.[cand]) ? cand : null
}

export function findByRid(tree, rid) {
  const r = String(rid)
  const out = []
  for (const q of Object.values(tree?.questions || {})) {
    if ((q.rids || []).includes(r)) out.push(q)
  }
  for (const t of Object.values(tree?.tasks || {})) {
    if ((t.rids || []).includes(r)) out.push(t)
  }
  return out
}

export const META_ID = 'META'
export const META_WEIGHT = 90
export const META_TEXT = '机制自身的边界（外置机制能不能真正约束住它）'

export function ensureMeta(tree, text = META_TEXT) {
  if (!tree) tree = newTree()
  if (!tree.tasks[META_ID]) {
    declareTask(tree, { id: META_ID, text, weight: META_WEIGHT, order: -1 })
  }
  return tree.tasks[META_ID]
}

export function takeBoundary(tree, { id, text, why, critical = false }) {
  ensureMeta(tree)
  return takeQuestion(tree, { id, parent: META_ID, text, why, critical })
}

export function metaQuestions(tree, { includeInvalid = false } = {}) {
  return Object.values(tree?.questions || {})
    .filter((q) => q.parent === META_ID)
    .filter((q) => includeInvalid || q.status !== 'invalid')
}

export const DISSOLVE_VERDICTS = ['dissolved', 'transformed', 'still']

export function dissolveSubtree(tree, id, { verdict, note, to = null } = {}) {
  if (!tree) return { ok: false, why: '无树' }
  const key = String(id)
  const v = String(verdict || '')
  if (!DISSOLVE_VERDICTS.includes(v)) {
    return { ok: false, why: `verdict 必须是 ${DISSOLVE_VERDICTS.join(' / ')} 之一（给不出就不算回执）` }
  }
  const node = tree.questions[key] || tree.tasks[key]
  if (!node) return { ok: false, why: `节点 ${key} 不存在` }
  if (v === 'transformed' && !to) {
    return { ok: false, why: 'transformed（转移矛盾）必须给 to（去向）—— 矛盾没消失，只是换位置，不记去向必反弹' }
  }
  const parentId = tree.questions[key] ? tree.questions[key].parent : null
  let invalidated = []
  if (v === 'dissolved') {
    const collect = (nid) => {
      const n = tree.questions[nid]
      if (!n) return
      if (n.status !== 'dissolved') { n.status = 'dissolved'; invalidated.push(nid) }
      for (const c of n.children || []) collect(c)
    }
    collect(key)
    node.status = 'dissolved'
    if (parentId) {
      const p = tree.questions[parentId] || tree.tasks[parentId]
      if (p) { p.need_retake = true; p.updated_at = now() }
    }
  } else if (v === 'transformed') {
    node.status = 'transformed'
    node.to = String(to)
    if (parentId) {
      const p = tree.questions[parentId] || tree.tasks[parentId]
      if (p) { p.need_retake = true; p.updated_at = now() }
    }
  } else {
    node.lift_fake = true
  }
  node.dissolve_verdict = v
  node.updated_at = now()
  tree.dissolve_log = (tree.dissolve_log || []).concat([{
    at: now(), id: key, verdict: v, note: String(note || ''), to: to ? String(to) : null,
    invalidated, parent: parentId,
  }])
  return { ok: true, id: key, verdict: v, invalidated, parent: parentId, to: to || null }
}

export function dissolvedNodes(tree, { includeTransformed = false } = {}) {
  const want = includeTransformed ? ['dissolved', 'transformed'] : ['dissolved']
  return Object.values(tree?.questions || {}).filter((q) => want.includes(q.status))
}

export function backToNode(tree, id, reason) {
  if (!tree) return { ok: false, why: '无树' }
  if (!reason) return { ok: false, why: '退回必须给 reason（为什么退回）—— 否则「回到空」不可复核' }
  const key = String(id)
  const node = tree.questions[key] || tree.tasks[key]
  if (!node) return { ok: false, why: `节点 ${key} 不存在` }
  const invalidated = []
  const collect = (nid) => {
    const n = tree.questions[nid]
    if (!n) return
    if (n.status !== 'invalid') { n.status = 'invalid'; invalidated.push(nid) }
    for (const c of n.children || []) collect(c)
  }
  collect(key)
  if (tree.questions[key]) tree.questions[key].status = 'invalid'
  if (tree.tasks[key]) tree.tasks[key].status = 'superseded'
  const parentId = tree.questions[key] ? tree.questions[key].parent : null
  if (parentId) {
    const p = tree.questions[parentId] || tree.tasks[parentId]
    if (p) { p.need_retake = true; p.updated_at = now() }
  } else if (tree.questions[key] && tree.questions[key].parent === null && tree.root) {
  }
  tree.back_log = (tree.back_log || []).concat([{
    at: now(), id: key, reason: String(reason), invalidated,
    parent: parentId, parent_need_retake: !!parentId,
  }])
  return { ok: true, id: key, invalidated, parent: parentId }
}

export function layeredOrder(tree, { includeInvalid = false } = {}) {
  const gone = GONE_STATUSES
  const tasks = Object.values(tree?.tasks || {})
    .filter((t) => includeInvalid || t.status !== 'superseded')
    .sort((a, b) => (a.order - b.order) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const questions = Object.values(tree?.questions || {})
    .filter((q) => includeInvalid || !gone.includes(q.status))
    .sort((a, b) => (b.weight - a.weight) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { tasks, questions }
}

export function treeLights(tree) {
  const lights = []
  const tasks = tree?.tasks || {}
  const questions = tree?.questions || {}
  if (tree && !tree.root) lights.push('🟡 根本问题 root 未设 —— 预算没有顶，排序矩阵没有根锚'
    + ' ⇒ 出口：`brain_task root:"整件事是一句什么话"`（一条即可；之后只在用户的向变了才改）')
  for (const t of Object.values(tasks)) {
    for (const d of t.deps || []) {
      if (!tasks[d]) lights.push(`🔴 任务 ${t.id} 的依赖 ${d} 悬空（指向不存在的任务）`)
    }
  }
  for (const q of Object.values(questions)) {
    if (q.parent !== null && !tasks[q.parent] && !questions[q.parent]) {
      lights.push(`🔴 子问题 ${q.id} 的父 ${q.parent} 悬空`)
    }
    if (!q.why) lights.push(`🔴 子问题 ${q.id} 缺 why（取的理由）—— 无权重的节点`)
  }
  for (const [id, n] of Object.entries({ ...tasks, ...questions })) {
    if (n.need_retake) lights.push(`🟠 ${id} 需重取（need_retake）—— 子节点被退回/消解，父节点还没重新取`)
  }
  for (const q of Object.values(questions)) {
    if (q.lift_fake) lights.push(`🔴 ${q.id} 声称被升维解决、但矛盾未变 ⇒ **这次升维是执**（新变量没进这条矛盾的判据）`)
  }
  for (const q of Object.values(questions)) {
    if (GONE_STATUSES.includes(q.status)) continue
    const s = nodeSignals(q)
    if (s.minus >= 2 && s.plus === 0) {
      lights.push(`🟠 ${q.id} 这个方向被压了 ${s.minus} 次、一条支持都没有`
        + ` ⇒ 两条出口：① 认它错了，brain_dissolve/back 退回重取；`
        + `② 说清为什么还值得留着（把理由写进 why，右过的下一次会看到）`)
    }
  }
  const ra = pressure(tree, null)
  if (ra.cap > 0 && ra.used > ra.cap) {
    lights.push(`🔴 根预算超额：任务合计 ${ra.used} > ${ra.cap}（差 ${ra.used - ra.cap}；根预算 = 整件事允许探究的总量）`
      + ` ⇒ 必须**回根重新分配**，不许再开新方向：`
      + `① 用 brain_task 把「不是现在要做」的任务降权（省下的额度给当前这条）`
      + `② 用 brain_task root_budget:${ra.used} 提高总预算（要写清为什么整件事值这么多）`)
  } else if (ra.cap > 0 && ra.left === 0 && ra.kids.length > 0) {
    lights.push(`🟠 根预算已分光（${ra.used}/${ra.cap}，${ra.kids.length} 件任务）`
      + ` ⇒ 再开新方向必须先**回根**：降一件的权（brain_task）或提高总预算（brain_task root_budget:N）`)
  }

  for (const q of Object.values(questions)) {
    if (GONE_STATUSES.includes(q.status) || q.status === 'superseded') continue
    const a = pressure(tree, q.id)
    if (a.cap > 0 && a.kids.length > 0 && a.left <= 0) {
      lights.push(`🟠 ${q.id} 方向预算已用尽（${a.used}/${a.cap}，${a.kids.length} 条子方向）`
        + ` ⇒ 这条路不能再往下延伸；必须回到 ${q.parent || '根'}（brain_back）或消解（brain_dissolve）`)
    }
  }

  for (const t of Object.values(tasks)) {
    if (t.status === 'superseded') continue
    const a = pressure(tree, t.id)
    if (a.used > a.cap) {
      lights.push(`🔴 ${t.id} 压力超额：子问题合计 ${a.used} > 额度 ${a.cap}（取冒了父的边界，差 ${a.used - a.cap}）`
        + ` ⇒ 出口二选一（不处置则本灯永亮）：`
        + `① 从已取的 [${a.kids.join(',') || '无'}] 里砍掉合计 ${a.used - a.cap} 的额度（取舍：砍谁、砍多少，说清代价）`
        + `② 用 brain_task 把 ${t.id} 的权重提到 ${a.used}（承认这条边界本来就这么大）`)
    } else if (a.cap > 0 && a.left === 0 && a.kids.length > 1) {
      lights.push(`🟡 ${t.id} 额度已分光（${a.used}/${a.cap}，${a.kids.length} 条）⇒ 再取必须先从现有里砍（取舍）`)
    }
  }
  for (const t of Object.values(tasks)) {
    for (const c of t.conflicts || []) {
      const o = tasks[c]
      if (!o) { lights.push(`🔴 任务 ${t.id} 的冲突边 ${c} 悬空（指向不存在的任务）`); continue }
      if (Number(o.weight) >= TASK_WEIGHT && Number(t.weight) >= TASK_WEIGHT) {
        lights.push(`🔴 ${t.id} ↔ ${c} 互斥但两条都满额 ⇒ 冲突被藏起来了（必须有一条让位并写代价）`)
      }
    }
  }
  return lights
}

export const AIM_FLOOR = 0.5

export function aimOf(tree, touchedIds = []) {
  const live = [
    ...Object.values(tree?.tasks || {}).filter((t) => t.status === 'active').map((t) => ({ id: t.id, w: Number(t.weight) || 0, lvl: 'T', text: t.text })),
    ...Object.values(tree?.questions || {}).filter((q) => q.status === 'active' || q.status === 'open')
      .map((q) => ({ id: q.id, w: Number(q.weight) || 0, lvl: 'Q', text: q.text })),
  ]
  if (!live.length) return { top: null, focus: null, aim: null, drift: false }
  const top = live.reduce((m, x) => (x.w > m.w ? x : m), live[0])
  const hits = live.filter((x) => touchedIds.map(String).includes(x.id))
  const focus = hits.length ? hits.reduce((m, x) => (x.w > m.w ? x : m), hits[0]) : null
  const aim = top.w > 0 ? (focus ? focus.w / top.w : null) : null
  return { top, focus, aim, drift: aim !== null && aim < AIM_FLOOR }
}

export function commandHint(tasks, lastUserText) {
  const real = Object.values(tasks || {}).filter((x) => x && x.id !== META_ID && x.status !== 'superseded' && x.status !== 'invalid')
  if (real.some((x) => x.origin === 'user')) return { line: '' }
  const lu = String(lastUserText || '').trim()
  if (!lu || !looksLikeCommand(lu, lu)) return { line: '' }
  return {
    line: '⚠️ 用户给的是一句**口令**（不是任务）—— 机制该接管，但"要做什么"还没说。'
      + '出口两条：① 先问他要做什么；② 自己找活就标 `origin:"self"`，并在回复里写明「这条是我自己找的」。'
      + '（被问住时别把口令当任务：你四次会话对同一句「开机制」做了四件不同的事。）',
  }
}

export function aimHint(matrix, tree = null, floor = AIM_FLOOR) {
  const rows = (matrix && matrix.L1) || []
  const last = rows.slice(-1)[0] || null
  if (!last) return { drift: false, aim: null, line: '' }
  let aim = null
  if (tree) {
    const touched = last.moves || last.moved || []
    const again = aimOf(tree, touched)
    aim = again ? again.aim : null
    if (touched.length && aim !== null) {
      last.__top = again?.top?.id ?? null
      last.__focus = again?.focus?.id ?? null
    }
  } else if (typeof last.aim === 'number') {
    aim = last.aim
  }
  if (aim === null) return { drift: false, aim: null, line: '' }
  if (aim >= floor) return { drift: false, aim, line: '' }
  const focus = last.__focus || last.aim_focus || '（没碰上层）'
  const top = last.__top || last.aim_top || '（树上无最重项）'
  return {
    drift: true, aim,
    line: `⚠️ 这一轮没在干最重的那件：落点 ${focus} / 最重 ${top} = ${aim.toFixed(2)}（地板 ${floor}）`
      + ' —— 不拦你，但先问一句：它真该等吗？（连 6 轮偏低 ⇒ 局部最优；连 9 轮 ⇒ 长任务漂移）',
  }
}

export function weightMap(tree, pool) {
  const out = {}
  if (!tree) return out
  for (const rid of Object.keys((pool && pool.entries) || {})) {
    const hits = findByRid(tree, rid)
    out[rid] = hits.length ? Math.max(...hits.map((n) => Number(n.weight) || 0)) : 0
  }
  return out
}

export function treeSummary(tree) {
  if (!tree) return ['树：空']
  const tasks = Object.values(tree.tasks || {})
  const questions = Object.values(tree.questions || {})
  const activeQ = questions.filter((q) => !GONE_STATUSES.includes(q.status)).length
  const invalidQ = questions.filter((q) => q.status === 'invalid').length
  const dissolvedQ = questions.filter((q) => q.status === 'dissolved').length
  const out = [
    `任务树：任务 ${tasks.length} 个 ｜ 子问题 ${activeQ} 个（取错废掉 ${invalidQ} ｜ 升维消解 ${dissolvedQ}）`
      + (tree.root ? ` ｜ 根「${tree.root}」` : ' ｜ ⚠️根未设'),
  ]
  out.push(treeLights(tree).length ? `红灯：${treeLights(tree).join('；')}` : '红灯：（无）')
  return out
}
