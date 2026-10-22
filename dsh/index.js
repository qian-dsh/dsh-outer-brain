import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, statSync, readdirSync, renameSync } from 'node:fs'
import { join, dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import * as PAIR from './pair.mjs'
import * as C from './core.mjs'
import * as M from './matrix.mjs'
import * as T from './tree.mjs'
import * as BL from './belief.mjs'
import * as CN from './contradiction.mjs'
import * as P from './plan.mjs'
import * as JEV from './jev.mjs'
import * as TERR from './terrain.mjs'
import * as SPIN from './spin.mjs'
import * as FLOW from './flow.mjs'
import * as UNK from './unknown.mjs'
import * as AXA from './axioms.mjs'
import * as FAL from './falsify.mjs'
import * as J from './jury.mjs'
import * as L from './lift.mjs'
import * as LD from './layer.mjs'
import * as OB from './obligation.mjs'
import * as TRM from './terms.mjs'
import * as ESC from './escalate.mjs'

export const name = 'outer-brain'

export const inject = ['tools']

export const Config = {
  '~standard': {
    version: 1,
    vendor: 'outer-brain',
    validate(value) {
      return { value: value ?? {} }
    },
  },
  enabled: true,
  guide: true,
  ledger: 'ledger',
  decay: 0.35,
  cap: 3,
  autoEnforce: true,
  hardGate: true,
  stallLimit: 5,
  liftTtl: 3,
  stateFile: null,
  philosophyFile: null,
  diagFile: null,
  jury: {
    enabled: true,
    provider: '',
    model: '',
    timeoutMs: 60000,
    maxTokens: 2048,
  },
}

function newGraph() {
  return { tasks: {}, debt: {}, pool_fp: {}, separations: [], log: [], unknown_pool: [], repool_request: false }
}

export function scopeSlug(cwd) {
  const norm = String(cwd).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const s = norm.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(-40)
  const h = createHash('sha1').update(norm).digest('hex').slice(0, 6)
  return `${s || 'root'}-${h}`
}

export function sidSlug(sid) {
  const norm = String(sid).replace(/^session-/, '')
  const s = norm.replace(/[^a-zA-Z0-9]+/g, '').slice(0, 12).toLowerCase()
  const h = createHash('sha1').update(norm).digest('hex').slice(0, 4)
  return `${s || 'sid'}-${h}`
}

function statePaths(cfg) {
  const base = cfg.workDir || process.cwd()
  if (cfg.stateFile) return { file: resolve(cfg.stateFile), dir: base }
  if (!cfg.scope) return { file: null, dir: null }
  const dir = join(base, 'projects', cfg.scope)
  return { file: join(dir, 'outer-brain-state.json'), dir }
}

export function listLineStates(cfg, cwdSlug) {
  const base = cfg.workDir || process.cwd()
  const root = join(base, 'projects', cwdSlug)
  const out = []
  const push = (f) => {
    try { out.push({ file: f, mtime: statSync(f).mtimeMs }) } catch { }
  }
  push(join(root, '_legacy-outer-brain-state.json'))
  try {
    for (const d of readdirSync(join(root, 'sessions'))) {
      push(join(root, 'sessions', d, 'outer-brain-state.json'))
    }
  } catch { }
  return out.sort((a, b) => b.mtime - a.mtime)
}

export function blankState() {
  return {
    pool: C.newPool(), graph: newGraph(), cards: {}, matrix: M.newMatrix(), tree: T.newTree(),
    beliefs: {}, hazards: BL.newHazardStore(),
    contra: CN.newContradictionTree(),
    mustAnswer: { round: 0, items: [] },
    plan: P.newPlan(),
    ob: OB.newObligationStore(),
    terms_overrides: {},
  }
}

export function normalizeState(s) {
  const def = blankState()
  if (!s || typeof s !== 'object') return def

  const out = { ...def, ...s }

  if (s.pool) {
    const entries = {}
    for (const [k, v] of Object.entries(s.pool.entries || {})) {
      const e = (v && typeof v === 'object') ? v : {}
      if (!Array.isArray(e.hist)) e.hist = [0]
      entries[k] = e
    }
    out.pool = { ...def.pool, ...s.pool, entries, rounds: s.pool.rounds || [] }
  }
  if (s.graph) out.graph = { ...def.graph, ...s.graph, tasks: s.graph.tasks || {}, debt: s.graph.debt || {} }
  if (s.cards && typeof s.cards === 'object') out.cards = s.cards
  else out.cards = def.cards
  const mx = s.matrix
  out.matrix = (mx && Array.isArray(mx.L1) && Array.isArray(mx.L2) && mx.L3 && typeof mx.L3 === 'object')
    ? mx : def.matrix
  {
    const l3 = out.matrix.L3
    if (!Number.isFinite(Number(l3.updatedSeq))) {
      const rcRaw = Number(l3.roundsCounted)
      const rc = Number.isFinite(rcRaw) ? rcRaw : 0
      const inL2 = (out.matrix.L2 || []).reduce((a, r) => a + (Number(r?.n) || 0), 0)
      out.matrix.seq = (out.matrix.L1 || []).length + inL2 + rc
      l3.updatedSeq = rc > 0 ? rc : null
    }
  }
  if (!(s.tree && s.tree.tasks && typeof s.tree.tasks === 'object')) out.tree = def.tree
  const ct = s.contra
  out.contra = (ct && ct.nodes && typeof ct.nodes === 'object' && Array.isArray(ct.climbed))
    ? { ...def.contra, ...ct }
    : def.contra
  const ob = s.ob
  out.ob = (ob && ob.items && typeof ob.items === 'object')
    ? { ...def.ob, ...ob, items: ob.items }
    : def.ob
  OB.voidIfStale(out.ob)
  const ov = out.terms_overrides
  if (ov && typeof ov === 'object') {
    for (const [k, v] of Object.entries(ov)) {
      if (!v || typeof v !== 'object') continue
      try {
        TRM.redefine(k, { is: v.is, not: v.not, falsify: v.falsify, why: v.why || '（从盘恢复）', at: v.at || null })
      } catch { }
    }
  }
  return out
}

export function loadState(cfg) {
  const { file } = statePaths(cfg)
  if (file && existsSync(file)) {
    try {
      return normalizeState(JSON.parse(readFileSync(file, 'utf8')))
    } catch (error) {
      try { renameSync(file, `${file}.corrupt-${Date.now()}`) } catch { }
      diag(cfg, `STATE CORRUPT ${file}：${String(error?.message ?? error)} ⇒ 已隔离为 .corrupt，本轮从空开始`)
      ctx_warn(`外置大脑：状态文件读不出来（已隔离为 .corrupt）：${String(error?.message ?? error)}`)
    }
  }
  return blankState()
}

let ctx_warn = () => {}
export function setWarnLogger(fn) { if (typeof fn === 'function') ctx_warn = fn }

export function saveState(cfg, st) {
  const { file, dir } = statePaths(cfg)
  if (!file) return 'SKIPPED：无会话作用域（拒绝写入，避免污染全局）'
  try {
    mkdirSync(dir, { recursive: true })
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tmp, JSON.stringify(st, null, 1), 'utf8')
    renameSync(tmp, file)
    return file
  } catch (error) {
    return `保存失败：${String(error?.message ?? error)}`
  }
}

export function diag(cfg, msg) {
  const target = cfg.diagFile || (cfg.workDir ? join(cfg.workDir, '.outer-brain-diag.log') : null)
  if (!target) return
  try {
    mkdirSync(dirname(target), { recursive: true })
    appendFileSync(target, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {
  }
}

export function matrixLine(mx, pool, round = null) {
  const m = mx || M.newMatrix()
  const L3 = m.L3 || {}
  return `matrix L1=${(m.L1 || []).length} L2=${(m.L2 || []).length} rolls=${L3.rolls ?? 0}`
    + ` lastRoll=${L3.lastRound ?? '-'} updated=${L3.updatedRound ?? '-'}`
    + ` lights=${M.matrixLights(m, pool, round).length}`
}

export function selfFingerprint(metaUrl = import.meta.url) {
  try {
    const p = fileURLToPath(metaUrl)
    const s = statSync(p)
    const buf = readFileSync(p)
    return {
      src: basename(p),
      abs: p,
      bytes: s.size,
      sha: createHash('sha256').update(buf).digest('hex').slice(0, 16),
      mtime: new Date(s.mtimeMs).toISOString(),
    }
  } catch {
    return { src: '?', bytes: 0, sha: '?', mtime: '?' }
  }
}

export function mountLine(info) {
  const o = info || {}
  const fp = o.fp || {}
  const parts = [
    `tools=${o.tools ?? 0}`,
    `hooks=${o.hooks ?? 0}`,
    `enabled=${o.enabled === false ? 'false' : 'true'}`,
    `src=${fp.src || '?'}`,
    `bytes=${fp.bytes ?? 0}`,
    `ms=${o.ms ?? 0}`,
    `pid=${o.pid ?? '?'}`,
  ]
  if (o.state) parts.push(`state=${o.state}`)
  if (fp.sha) parts.push(`sha=${fp.sha}`)
  if (fp.abs) parts.push(`abs=${fp.abs}`)
  if (o.ok === true) return `mount OK ${parts.join(' ')}`
  const err = String(o.error ?? 'unknown').replace(/\s+/g, ' ').slice(0, 300)
  return `mount FAILED ${parts.join(' ')} err=${err}`
}

export function collectAll(entries, label, ledger) {
  const keys = new Set(Object.keys(entries))
  const ev = C.collectOps(entries, keys, label, ledger, false)
  const debt = C.collectOps(entries, keys, null, ledger, false)
  const seen = new Set()
  const merged = []
  for (const o of ev.concat(debt)) {
    const k = `${o.rid}|${o.op}`
    if (seen.has(k)) continue
    seen.add(k)
    merged.push(o)
  }
  return C.mergeClusters(merged)
}

export function matrixRow(st, r, cfg, label) {
  if (!st.matrix) st.matrix = M.newMatrix()
  const pv = Object.values(st.beliefs || {}).map((b) => Number(b.p)).filter(Number.isFinite)
  const pMean = pv.length ? pv.reduce((a, c) => a + c, 0) / pv.length : null
  const pPrev = st.matrix._pPrev ?? pMean
  const dMean = pMean === null || pPrev === null ? null : pMean - pPrev
  const pDelta = dMean === null ? null : Math.abs(dMean)
  if (pMean !== null) st.matrix._pPrev = pMean

  const nowIso = new Date().toISOString()
  const since = st.matrix.lastRowAt || null
  const moves = []
  let nSat = 0
  if (since) {
    for (const [bid, b] of Object.entries(st.beliefs || {})) {
      const hs = b.hist || []
      for (let i = 1; i < hs.length; i += 1) {
        const h = hs[i]
        if (!h.at || !(h.at > since)) continue
        const from = Number(hs[i - 1].p)
        const to = Number(h.p)
        if (!Number.isFinite(from) || !Number.isFinite(to)) continue
        const d = to - from
        const moved = Math.abs(d) > BL.EPS_MOVE
        const sat = h.sat === true || (!moved && (to <= 0.021 || to >= 0.989))
        if (!moved) {
          if (sat) nSat += 1
          continue
        }
        moves.push({
          id: bid,
          from: Math.round(from * 1000) / 1000,
          to: Math.round(to * 1000) / 1000,
          dir: d < 0 ? 'down' : 'up',
          why: String(h.why || '').slice(0, 40),
        })
      }
    }
  }
  st.matrix.lastRowAt = nowIso
  const nDrops = moves.filter((m) => m.dir === 'down').length

  const contested = Object.values(st.beliefs || {}).filter((b) => (b.n_contra || 0) > 0).length
  const cs = CN.contraSummary(st.contra)
  const touched = [...new Set((r.ops || []).map((o) => st.pool?.entries?.[o.rid]?.qid).filter(Boolean))]
  const aim = T.aimOf(st.tree, touched)
  return M.pushL1(st.matrix, {
    round: label,
    alarms: r.lambdaAction,
    cap: cfg.cap,
    chosen: (r.ops || []).map((o) => o.op),
    dropped: (r.dropped || []).map((d) => d.op),
    directionChanged: !!r.moved,
    p_mean: pMean, p_delta: pDelta, p_delta_signed: dMean,
    moves, n_moves: moves.length, n_drops: nDrops, n_sat: nSat,
    contested,
    aim: aim.aim, aim_top: aim.top?.id ?? null,
    aim_focus: aim.focus?.id ?? null, aim_bad: !!aim.drift,
    contra_open: cs.open, contra_max_level: cs.maxLevel,
    contra_parked: cs.parked, contra_fake: cs.fake,
    contra_climbed: cs.climbed, contra_retake: cs.retake_pending.length,
    contra_root: cs.root_status,
  })
}

export function enforce(st, cfg, label) {
  const { pool, graph } = st
  pool.ledger = cfg.ledger
  pool.decay = cfg.decay

  const cats = {}
  for (const [rid, e] of Object.entries(pool.entries)) {
    cats[rid] = C.classify(e, C.triggers(e, label, cfg.ledger))
  }
  const fakeRids = new Set(Object.entries(cats).filter(([, c]) => c[0] === '假矛盾').map(([r]) => r))
  const undetRids = Object.entries(cats).filter(([, c]) => c[0] === '未定矛盾').map(([r]) => r)

  const all = collectAll(pool.entries, label, cfg.ledger).filter((o) => !fakeRids.has(o.rid))
  const before = C.directionOf(graph)
  const nBefore = Object.keys(graph.tasks).length

  const [ops, dropped] = C.take(all, cfg.cap, graph.debt, T.weightMap(st.tree, pool))
  const seq0 = Math.max(0, ...Object.values(graph.tasks).map((t) => t.seq || 0))
  const ctr = { lift: 0, split: 0, obs: 0, seq: seq0 }
  const [changes, newNodes] = C.applyOps(graph, ops, label, ctr)

  for (const o of ops) delete graph.debt[`${o.op}·${o.rid}`]
  for (const d of dropped) {
    const k = `${d.op}·${d.rid}`
    graph.debt[k] = (graph.debt[k] || 0) + 1
  }

  const reviewAssigned = []
  for (const o of ops) {
    if (o.op !== 'RERUN') continue
    for (const r of o.members || [o.rid]) {
      const e = pool.entries[r]
      if (e && e.chal_since_review) {
        e.review_assigned = (e.review_assigned || 0) + 1
        e.review_assigned_at = new Date().toISOString()
        e.review_assigned_round = label
        reviewAssigned.push(r)
      }
    }
  }
  const reviewed = []

  const after = C.directionOf(graph)
  const moved = JSON.stringify(before) !== JSON.stringify(after)
    || Object.keys(graph.tasks).length !== nBefore

  graph.unknown_pool = undetRids.map((r) => ({ rid: r, why: cats[r][1], how: cats[r][2], round: label }))
  graph.repool_request = C.repoolNeeded(undetRids.length, Object.keys(cats).length)
  if (dropped.length) {
    graph.separations = (graph.separations || []).concat(dropped.map((d) => ({ ...d, round: label })))
  }
  graph.log = (graph.log || []).concat([{
    event: 'enforce', round: label, ops: ops.map((o) => o.op), changes: changes.length,
  }])

  const lifts = ops.filter((o) => o.op === 'LIFT')
  if (lifts.length) {
    if (!st.lift_pending) st.lift_pending = []
    for (const o of lifts) {
      const t = (graph.tasks || {})[`L-${o.rid}`]
      if (t && t.lift_diag === 'still') continue
      if (!st.lift_pending.some((p) => p.rid === o.rid)) {
        st.lift_pending.push({ rid: o.rid, at: new Date().toISOString(), round: label })
      }
    }
  }

  return {
    label, cats, ops, dropped, changes, newNodes, reviewed, before, after, moved,
    fakeRids: [...fakeRids], undetRids,
    lambdaRaw: all.reduce((a, o) => a + (o.k || 1), 0),
    lambdaAction: all.length,
  }
}

export const PLACEHOLDER_ROUND = 'auto'

export function observeRound(st, args) {
  const rid = String(args.rid)
  if (!st.pool.entries[rid]) {
    st.pool.entries[rid] = C.newEntry('（插件新建）', args.priorBand || '中')
  }
  if (!st.pool._begun) {
    C.beginRound(st.pool, PLACEHOLDER_ROUND)
    st.pool._begun = true
  }
  const structured = args.receipt !== undefined || args.pE_if_true !== undefined || args.expect !== undefined
  if (!st.beliefs) st.beliefs = {}
  if (!st.hazards) st.hazards = BL.newHazardStore()
  const e = st.pool.entries[rid]

  if (args.evidenceClass === 'precedent') {
    const src = String(args.source_ref || '').trim()
    if (!src) {
      return { accepted: false, rid,
        why: '先例类必须给 source_ref（文档名+版本 / 仓库+commit / 厂商名）—— 指名到可查，写"网上说/业界普遍"不收' }
    }
    const pred = String(args.expect ?? '').trim()
    const obs = String(args.observed ?? '').trim()
    if (!pred || !obs) {
      return { accepted: false, rid,
        why: '先例类必须**转写成本项目判据**（expect：按它的做法，我这里应等于什么）+ 实测（observed）'
          + ' —— 借判据不借结论。只写"别人这么做"的不收' }
    }
    const h = BL.judgeHit({ expect: args.expect, observed: args.observed, tol: args.tol })
    if (!Array.isArray(e.precedents)) e.precedents = []
    e.precedents.push({
      at: new Date().toISOString(), source_ref: src,
      what: String(args.why || '').slice(0, 240),
      expect: pred, observed: obs, same: h.hit, how: h.why,
    })
    if (e.precedents.length > 20) e.precedents = e.precedents.slice(-20)
    if (h.hit) e.precedent_same = (e.precedent_same || 0) + 1
    else e.precedent_diverge = (e.precedent_diverge || 0) + 1
    let answered = null
    const aq = String(args.answers || '').trim()
    if (aq) {
      const lk = T.linkRid(st.tree, aq, rid)
      if (lk.ok) { answered = aq; e.qid = aq }
    }
    return {
      accepted: true, rid,
      先例已记: `${e.precedents.length} 条（一致 ${e.precedent_same || 0} / 不一致 ${e.precedent_diverge || 0}）`,
      与先例: h.hit
        ? '一致 ⇒ 信息量低：可能只是找背书，也可能确实殊途同归'
        : '不一致 ⇒ 这才是借鉴的价值：知道差在哪、为什么差',
      不动水位: '先例不进贝叶斯（它记在"升维的输入"上：lift 要求至少 1 条先例）',
      ...(answered ? { 已交必答: answered } : {}),
      qid: e.qid ?? null,
    }
  }

  let ok
  let msg
  let beliefOut = null
  if (!structured) {
    const r = C.addEvidence(st.pool, rid, {
      direction: args.direction, strength: Number(args.strength), why: String(args.why || ''),
      lr: args.lr, evidencePp: args.evidencePp, evidenceClass: args.evidenceClass,
      exclusive: args.exclusive,
    })
    ok = r[0]
    msg = r[1] + ' ⚠️ 自述通道（未给 receipt / pE_if_true）⇒ 不计入校准，也不产生后验'
    e.selfReported = (e.selfReported || 0) + 1
  } else {
    if (!st.beliefs[rid]) {
      const band = args.priorBand
      const prior = Number.isFinite(Number(args.prior)) ? Number(args.prior)
        : band === '高' ? 0.8 : band === '低' ? 0.25 : 0.5
      st.beliefs[rid] = BL.newBelief({
        id: rid, claim: String(args.claim || args.why || rid), prior,
        assumptions: Array.isArray(args.assumptions) ? args.assumptions : [],
        source: String(args.source || 'agent'),
        done_when: String(args.done_when || ''),
        at: new Date().toISOString(),
      })
    }
    const b = st.beliefs[rid]
    const upd = BL.update(b, {
      why: String(args.why || ''),
      expect: args.expect, observed: args.observed, tol: args.tol,
      pE_if_true: args.pE_if_true, pE_if_false: args.pE_if_false,
      receipt: args.receipt, receiptGrade: args.receiptGrade, verified: args.verified,
      evidenceClass: args.evidenceClass, exclusive: args.exclusive,
      source_ref: args.source_ref,
      hit: args.hit, hit_by: args.hit_by,
      at: new Date().toISOString(),
    })
    ok = upd.ok
    msg = upd.reason
    if (ok) {
      e.n = BL.logit(b.p)
      e.hist.push(b.p)
      e.p = b.p
      e.accepted = (e.accepted || 0) + 1
      if (upd.lr < 1) {
        e.challenge = (e.challenge || 0) + 1
        e.chal_since_review = (e.chal_since_review || 0) + 1
      } else if (upd.lr > 1) {
        e.support = (e.support || 0) + 1
      }
      e.sign = !Number.isFinite(Number(upd.lr)) ? 'zero'
        : Number(upd.lr) > 1.0001 ? 'plus'
          : Number(upd.lr) < 0.9999 ? 'minus' : 'zero'
      e.stale = 0
      if (args.evidenceClass === 'precedent') {
        const jj = BL.judgeHit({ expect: args.expect, observed: args.observed, tol: args.tol })
        if (jj.hit) e.precedent_same = (e.precedent_same || 0) + 1
        else e.precedent_diverge = (e.precedent_diverge || 0) + 1
      }
    } else {
      e.unreceipted = (e.unreceipted || 0) + 1
    }
    beliefOut = { p: b.p, prior: b.prior, peak: b.p_peak, n_contra: b.n_contra,
      n_support: b.n_support, status: b.status,
      would_contract: BL.shouldContract(b) }
  }
  if (args.weight !== undefined) e.weight_selfreported = Number(args.weight)
  if (args.root !== undefined) e.root = String(args.root)
  if (args.layer !== undefined) e.layer = String(args.layer)
  let linkWarn = null
  let signNote = null
  let answered = null
  const ansQid = (args.answers !== undefined && args.answers !== null)
    ? String(args.answers).trim() : ''
  if (ansQid) {
    const lk2 = T.linkRid(st.tree, ansQid, rid)
    if (lk2.ok) {
      e.qid = ansQid
      e.answers = ansQid
      answered = ansQid
    } else linkWarn = `answers 挂账失败：${lk2.why}`
  }
  if (!answered) {
    const explicit = (args.qid !== undefined && args.qid !== null) ? String(args.qid) : ''
    const target = explicit || T.inferQid(st.tree, rid)
    if (target) {
      const lk = T.linkRid(st.tree, String(target), rid)
      if (lk.ok) {
        e.qid = String(target)
        if (!explicit) e.qid_inferred = true
      } else linkWarn = lk.why
    }
  }
  if (e.qid && e.sign) {
    const ms = T.markSign(st.tree, e.qid, rid, e.sign)
    if (ms.ok && !ms.dup) signNote = `${e.qid} 方向证据家底 +${ms.ev.plus}/−${ms.ev.minus}/0:${ms.ev.zero}`
  }
  if (!st.cards) st.cards = {}
  if (!st.cards[rid]) st.cards[rid] = C.newCard(rid, { kind: '未取' })
  if (args.root !== undefined) st.cards[rid].root = String(args.root)
  if (args.layer !== undefined) st.cards[rid].layer = String(args.layer)
  if (st.cards[rid].root === null || st.cards[rid].layer === null) {
    st.cards[rid].commits.push({ at: new Date().toISOString(),
      what: '⚠️ 锚为空（root/layer 未提供）⇒ 本卡进不了排序矩阵，只是散卡' })
  }
  C.commit(st.cards[rid], `observe ${args.direction} ok=${ok} :: ${args.why}`)
  const wtree = T.weightMap(st.tree, st.pool)
  return { accepted: ok, message: msg, rid, e, belief: beliefOut,
    ...(ok ? {} : {
      白记了: `本条**权重 0、水位不动**（池子里没加上水）——原因：${msg || '未知'}。`
        + `\n  ⇒ 补上"回执"再交一次：receipt = 怎么验的、在哪能看到（命令原文 / 路径 / URL / 输出摘要）。`
        + (args.direction && !args.receipt
          ? '\n  你现在走的是**旧通道**（direction+strength），它不产生 p —— 换成新通道给 claim/prior/expect/observed/receipt/pE_if_true/pE_if_false。'
          : ''),
    }),
    ...(linkWarn ? { 挂树失败: linkWarn } : {}),
    ...(answered
      ? { 已交必答: answered, 说明: `本条已挂到 ${answered} ⇒ 下一轮对账按 ${answered}.rids 认账` }
      : {}),
    ...(e.qid_inferred ? { 自动挂树: e.qid, 说明: `未给 qid，按命名推到 ${e.qid}（推不出不挂）` } : {}),
    ...(signNote ? { 方向家底: signNote } : {}),
    ...(beliefOut?.would_contract
      ? { 回到空: '本条已被两条独立反证压到地板以下 ⇒ 该撤销这次「取」重取（brain_dissolve 带 verdict）' }
      : {}),
    qid: e.qid ?? null,
    weight: wtree[rid] ?? 0,
    权重来源: (wtree[rid] ?? 0) > 0
      ? `树节点 ${e.qid} 的额度（不是本条自填的；自填值只留档）`
      : '⚠️散卡：没挂到树上 ⇒ 排序恒排最后。用 qid 指认它属于哪条子问题',
    root: e.root ?? null, layer: e.layer ?? null }
}

export function buildMustAnswerForRound(st) {
  if (!st.mustAnswer) st.mustAnswer = { round: 0, items: [] }
  if (!st.beliefs) st.beliefs = {}
  if (!st.hazards) st.hazards = BL.newHazardStore()
  const prev = st.mustAnswer.items || []

  const seen = {}
  const normId = (x) => String(x)
    .replace(/[-_]?复核\d*/g, '')
    .replace(/[-_（(]\d+[)）]?$/, '')
  for (const it of prev) {
    if (it.kind === 'question') {
      const q = st.tree?.questions?.[it.id]
      if (q && (q.rids || []).length > 0) seen[`question:${it.id}`] = 1
    } else if (it.kind === 'belief') {
      const group = Object.values(st.beliefs || {})
        .filter((x) => x.id !== 'M-必答已交' && normId(x.id) === normId(it.id))
      const maxN = Math.max(0, ...group.map((x) => x.n_updates || 0))
      if (group.length && maxN > (it.n0 || 0)) seen[`belief:${it.id}`] = 1
    } else if (it.kind === 'hazard') {
      const h = st.hazards?.items?.[it.id]
      if (h && h.status !== 'open') seen[`hazard:${it.id}`] = 1
    } else if (it.kind === 'contra') {
      const n = st.contra?.nodes?.[it.id]
      if (n && ((n.attempts || []).length > (it.n0 || 0) || n.status !== 'open')) seen[`contra:${it.id}`] = 1
    }
  }
  const missed = BL.reconcileMustAnswer(prev, seen)

  if (missed.length) {
    const id = 'M-必答已交'
    if (!st.beliefs[id]) {
      st.beliefs[id] = BL.newBelief({
        id, claim: 'agent 每轮都会回应机制下发的必答单（不用逼）', prior: 0.75, source: 'mechanism',
      })
    }
    BL.update(st.beliefs[id], {
      why: `上轮下发 ${prev.length} 项必答，本轮未交 ${missed.length} 项：`
        + missed.map((m) => `${m.kind}:${m.id}`).join('、'),
      expect: 0, observed: missed.length, tol: 0,
      pE_if_true: missed.length === 0 ? 0.90 : 0.05,
      pE_if_false: missed.length === 0 ? 0.20 : 0.85,
      receipt: 'mechanism.mustAnswer.reconcile :: 从状态推导（不看自述）',
      receiptGrade: 'verified',
      at: new Date().toISOString(),
    })
  }

  let died = null
  {
    const mc0 = st.beliefs['M-必答已交']
    if (mc0 && BL.shouldContract(mc0)) {
      const eff0 = Number.isFinite(mc0.n_contra_eff)
        ? `（其中 ${mc0.n_contra_eff} 条真压动了 p）` : '（有效条数未记录：旧盘）'
      died = BL.contract(mc0, `${mc0.n_contra} 条反证记录${eff0}、p=${mc0.p.toFixed(3)} 跌破地板 ⇒ 本办法判死`)
      st.mustAnswer.died_at = new Date().toISOString()
      st.mustAnswer.died_retract = died.retracted || []
    }
  }

  st.mustAnswer.round = (st.mustAnswer.round || 0) + 1
  const items = BL.buildMustAnswer({
    questions: st.tree?.questions || {},
    beliefs: Object.values(st.beliefs).filter((b) => b.id !== 'M-必答已交'),
    hazards: st.hazards,
    round: st.mustAnswer.round,
  })

  if (!st.contra) st.contra = CN.newContradictionTree()
  if (!st.contra.root) {
    items.unshift({
      kind: 'contra', id: 'C0', text: '（还没有主矛盾）',
      expect: '先观察再找矛盾：op:"observe" 写清「我（现状）」↔「目标」、差在哪个事实上、属七类哪一类。'
        + '不许写"有困难"这种没有两端的句子',
    })
  } else {
    const deepest = CN.deepestOpen(st.contra)
    if (deepest) {
      const g = CN.canClimb(deepest)
      const acts = [...new Set((deepest.attempts || []).map((a) => a.act))]
      items.unshift({
        kind: 'contra', id: deepest.id,
        text: `L${deepest.level}·${deepest.kind} ${String(deepest.statement).slice(0, 48)}`,
        expect: g.ok
          ? `本层已无解（${g.why}）⇒ op:"climb" 回到 L${deepest.level - 1} 重定义再取（必须换边界、加变量）`
          : `本层未解 ⇒ op:"try" 试一手（本类默认「${CN.DEFAULT_ACT[deepest.kind] || '?'}」；已试 ${acts.join('/') || '无'}），`
            + `至少两种手法都没果才准上爬`,
      })
    }
    const rr = Object.values(st.contra.nodes).filter((n) => n.retake_required)
    for (const n of rr.slice(0, 1)) {
      items.push({
        kind: 'retake', id: n.id,
        text: `L${n.level} ${n.id} 已被要求重新定义再取（上次边界「${n.retake_required.forbid_boundary || '-'}」作废）`,
        expect: 'op:"child" 时带上 model{vars,boundary,criterion,predict}，且新边界不得等于作废的那条',
      })
    }
    if (!CN.deepestOpen(st.contra)) {
      const rootNode = st.contra.nodes[st.contra.root]
      if (rootNode && rootNode.status !== 'coexisting') {
        const shelved = Object.values(st.contra.nodes).filter((n) => n.status === 'shelved')
        items.unshift({
          kind: 'contra', id: st.contra.root,
          text: `主矛盾 ${st.contra.root} 仍成立（${String(rootNode.statement).slice(0, 40)}），`
            + '但下面没有在走的子矛盾',
          expect: '停手不等于办完：要么 op:"child" 从主矛盾再取一条（换边界、加变量、指认出处），'
            + '要么 op:"coexist" 写清代价与期限。'
            + (shelved.length
              ? `已停手的：${shelved.slice(0, 3).map((n) => `${n.id}@「${n.stop_at || '-'}」`).join('、')}`
              : ''),
        })
      }
    }
  }

  const mapped = items.map((it) => ({
    ...it,
    n0: it.kind === 'belief' ? (st.beliefs?.[it.id]?.n_updates || 0)
      : it.kind === 'contra' ? ((st.contra?.nodes?.[it.id]?.attempts || []).length)
        : 0,
  }))
  if (died) {
    const nc = st.beliefs['M-必答已交']?.n_contra || 0
    const ncEff = st.beliefs['M-必答已交']?.n_contra_eff
    const ncNote = Number.isFinite(ncEff) ? `${nc} 条反证记录，其中 ${ncEff} 条真压动了 p` : `${nc} 条反证记录（有效条数未记录：旧盘）`
    st.mustAnswer.items = [{
      kind: 'switch', id: 'SW-1',
      text: `「每轮必答」这套手段已判死（${ncNote}，p 跌破地板）—— 它失败了 20 轮，再原样发一遍只是让它假装在动`,
      expect: `交回的假设：${(died.retracted || []).join('、') || '（那次「取」没记假设）'}。`
        + '这一步只做一件事：**换一件和上次不同、且当场能验的事**（命令 / 文件 / URL 三选一），'
        + '或写明"这批项本身不可能被交"的理由。不许再把同一批必答项原样交回来。',
    }]
  } else {
    st.mustAnswer.items = mapped
  }
  const mc = st.beliefs['M-必答已交']
  return {
    round: st.mustAnswer.round,
    items: st.mustAnswer.items, missed, died: died ? died.why : null,
    compliance: mc ? { p: mc.p, contra: mc.n_contra, status: mc.status } : null,
  }
}

export function mustAnswerLines(ma) {
  const out = []

  out.push('【必答 · 一句话】**这轮你推进了哪个子目标？给出它的 id**（如 M23）。')
  out.push('  · 有 ⇒ 写 id（没写过的先 brain_plan 建一条）／没有（在做铺垫/调研/修 bug）⇒ 写「没有，我在做 X」，X 要能被核（**文件/命令/退出码**）／答不上来 ⇒ 写清「为什么这轮无法回答」（写不出理由 = 机制记一条挑战）')

  if (ma.died) {
    out.push(`🔴 **本办法已判死**：${ma.died}`)
    out.push('· 判死 = 不许原地重复（不是"再努力一点"）。下面只发一条，且必须是和上次不同的做法。')
  }
  if (ma.missed?.length) {
    out.push(`⚠️ 上轮必答未交 ${ma.missed.length} 项（机制已自行记账，不由你自报）：`
      + ma.missed.map((m) => m.id).join('、'))
  }
  if (ma.compliance) {
    out.push(`· 「你每轮会回应必答单」这条信念：p=${ma.compliance.p.toFixed(3)}`
      + `${ma.compliance.contra ? `（反证 ${ma.compliance.contra} 条）` : ''}`
      + (ma.compliance.status !== 'alive' ? ' ⇒ **已判死，机制须换手段**' : ''))
  }
  if (ma.items?.length) {
    out.push(`必答 ${ma.items.length} 项（**这笔账跨轮存续**：不交就一直在账上，`
      + '不是"这一轮勾完就销账"；不答不改 p，由机制记一条挑战）：')
    out.push('  · ' + ma.items.map((it) => {
      const tag = it.kind === 'question' ? '未答问题'
        : it.kind === 'belief' ? '最低置信'
          : it.kind === 'hazard' ? '到期隐患'
            : it.kind === 'contra' ? '矛盾'
              : it.kind === 'switch' ? '换手段' : '须重取'
      return `[${tag}·${it.id}]`
    }).join(' / '))
    out.push('  ⇒ 每条要什么：`brain_status`（正文不刷屏，但账在这儿，一条不少）')
  }
  return out
}

const COMPLY_BELIEF_ID = 'M-必答已交'
export function quietGate(st, cfg, stallStreak = 0) {
  const limit = Number(cfg?.stallLimit ?? 5)
  const raw = st?.beliefs?.[COMPLY_BELIEF_ID]?.p
  const known = raw !== undefined && raw !== null && Number.isFinite(Number(raw))
  const p = known ? Number(raw) : 1
  const on = known && stallStreak >= limit && p < 0.05
  return {
    on, limit, complyP: p, stallStreak, known,
    why: on
      ? `stall=${stallStreak}≥${limit} 且 complyP=${p.toFixed(3)}<0.05 ⇒ 判死，停止重念`
      : (!known ? '无 M-必答已交 信念 ⇒ 不判（不猜）'
        : stallStreak < limit ? `stall=${stallStreak}<${limit}`
          : `complyP=${p}≥0.05（还活着）`),
  }
}

export function quietLines({ ma, hd, qg }) {
  const out = []
  const missN = ma?.missed?.length || 0
  const itemN = ma?.items?.length || 0
  const ids = (ma?.missed || []).map((m) => m.id).slice(0, 6).join('、')
  out.push(`【外置大脑 · 降噪】账还在，但不再每轮重念（连续 ${qg?.stallStreak ?? 0} 轮零 brain_* 回应 · `
    + `「每轮会回应必答单」这颗信念 p=${Number(qg?.complyP ?? 0).toFixed(3)} ⇒ 已判死）。`)
  const bits = []
  if (missN || itemN) bits.push(`未交 ${missN} 项${missN ? `（${ids}）` : ''} / 新派 ${itemN} 项`)
  if (hd && hd.severity !== 'none') {
    const redN = (hd.lines || []).filter((l) => String(l).startsWith('🔴')).length
    bits.push(`硬指令 ${hd.lines.length} 行（${hd.severity}${redN ? ` · 🔴 ${redN}` : ''}）`)
  }
  if (bits.length) out.push(`· 账：${bits.join('；')} —— **照记照对账，只是正文不刷屏**。`)
  out.push('· 全文 `brain_status`；`brain_observe` / `brain_settle` / `brain_status` 任一发生即恢复全量下发。')
  out.push('· ⚠️ 要收尾先写「还差什么、为什么停」；拿「预算 / 上下文 / 累了」停 = 未完成，欠账照样在攒。')
  return out
}

export function mustAnswerTrace(ma, qg, t = 0) {
  return `mustAnswer turn=${t} items=${(ma?.items || []).length} missed=${(ma?.missed || []).length}`
    + (ma?.compliance ? ` complyP=${Number(ma.compliance.p).toFixed(3)}` : '')
    + ` quiet=${qg?.on ? 1 : 0}`
}

export function settleRound(st, label, reviews = []) {
  const done = []

  try {
    if (!st.tree.tuning) st.tree.tuning = { rounds: 0, last_small: 0, last_large: 0 }
    st.tree.tuning.rounds = Number(st.tree.tuning.rounds || 0) + 1
    const n = st.tree.tuning.rounds
    const sinceSmall = n - Number(st.tree.tuning.last_small || 0)
    const sinceLarge = n - Number(st.tree.tuning.last_large || 0)
    const dueLarge = n >= 50 && sinceLarge >= 50
    const dueSmall = n >= 10 && sinceSmall >= 10
    if (dueLarge || dueSmall) {
      const large = dueLarge
      if (large) st.tree.tuning.last_large = n
      st.tree.tuning.last_small = n
      st.tree.tuning.last_checked = n
      st.tree.tuning.due = {
        kind: large ? 'large' : 'small',
        rounds: n,
        at: new Date().toISOString(),
        checklist: large
          ? [
            '结构层：现有 11 个模块里，有没有哪个从没在真机上起过作用（对照 diag 的工具/钩子命中）',
            '结构层：有没有该合并的（两个模块总是同时被调），或该拆的（一个模块承担两种判断）—— 判据：看 diag 里的调用共现',
            '判据层：test_*.mjs 里有没有恒绿的（stub_probe 空跑仍绿）',
            '阈值层：TOOL_COST 的五个数标定过没有（现在是估的，范围 3-8 / 1-3 / 0.5-2）',
          ]
          : [
            '常量层：这一批里有没有哪个阈值被针对性地绕过（判据变绿但改动没被覆盖）',
            '常量层：水位线 10 / 预算 80% / 判据 30s 这三个数，这一批各触发了几次（太多=太紧，0 次=太松）',
            '话术层：这几批的返回里，有没有哪个字段从没被读过（读了才有用）',
          ],
      }
    }
  } catch {}
  for (const r of reviews || []) {
    const rid = String(r && r.rid ? r.rid : '')
    const e = st.pool.entries[rid]
    if (!e) { done.push({ rid, ok: false, why: '无此条目' }); continue }
    if (!r.verdict || !r.why) {
      done.push({ rid, ok: false, why: '缺 verdict/why ⇒ 不算完成（不许空账清零）' })
      continue
    }
    C.markReviewed(e)
    e.review_log = (e.review_log || []).concat([{
      at: new Date().toISOString(), round: String(label), verdict: String(r.verdict), why: String(r.why),
    }])
    e.review_assigned = 0
    done.push({ rid, ok: true, verdict: String(r.verdict) })
  }
  if (!st.pool._begun) {
    C.beginRound(st.pool, label)
  } else {
    const rs = st.pool.rounds
    const i = rs.length - 1
    if (i >= 0 && rs[i] === PLACEHOLDER_ROUND && String(label || '')) rs[i] = String(label)
  }
  C.settle(st.pool, label)
  st.pool._begun = false
  st.pool._last_reviews = done
  return st.pool
}

const TAG = (t) => t.split(' ')[0]

export function renderReport(st, cfg) {
  const { pool, graph } = st
  const rows = []
  rows.push(`【外置大脑 · 当前状态】账本=${cfg.ledger} 折价率=${cfg.decay} 额度CAP=${cfg.cap}`)
  rows.push(`池中 ${Object.keys(pool.entries).length} 条；agent 已认账轮次：${(pool.rounds || []).join(' → ') || '（无）'}`)
  rows.push('')
  rows.push('条目水位（conf 现值 / 峰值 / 档位 / 观测数 / 累计挑战）：')
  for (const [rid, e] of Object.entries(pool.entries).sort()) {
    const c = C.confNow(e, cfg.ledger, cfg.decay)
    const peak = Math.max(...e.hist)
    rows.push(`  ${rid.padEnd(5)} ${c.toFixed(3)} / ${peak.toFixed(3)} / ${C.bandOf(c)} / `
      + `acc=${e.accepted || 0} ch=${e.challenge || 0} stale=${e.stale || 0}`)
  }
  rows.push('')
  const alerts = []
  for (const [rid, e] of Object.entries(pool.entries)) {
    for (const [t] of C.triggers(e, null, cfg.ledger)) alerts.push(`  ${rid.padEnd(5)} ${t}`)
  }
  rows.push(`报警（欠账口径 = 至今未复核，共 ${alerts.length} 条）：`)
  rows.push(...(alerts.length ? alerts : ['  （无）']))
  return rows.join('\n')
}

export function renderBrief(st, cfg) {
  const { pool, graph } = st
  const lines = []
  const rootAnchor = String(st.tree?.root || '').trim()
  lines.push('【外置大脑 · 本次讨论边界】')
  lines.push(`  在讨论：${rootAnchor || '⚠️ 没设根锚 —— 整件事还没有一句话的界定（brain_task 的 root 参数）'}`)
  lines.push('  机制管：可判定的事 —— 判据红没红、账对不对、哪几件里程碑没绿')
  lines.push('  机制不管：内容好不好、审美、"用户到底想要什么"（后者由用户界定，机制只记不猜）')
  lines.push('  术语是意象、可重定义 —— 认知上要随时准备改词，但改词的入口（`brain_terms`）已于 2026-10-19 下线，别再调它。')
  lines.push('')
  lines.push('【外置大脑 · 分层清单】—— L1 任务(你的话) > L2 子问题(取的矛盾) > L3 矩阵(该做什么)')
  lines.push('')

  const tree = st.tree || T.newTree()
  const { tasks, questions } = T.layeredOrder(tree)
  const mbAll = T.metaQuestions(tree)
  const mbIds = new Set(mbAll.map((q) => q.id))
  const evTag = T.evTag
  {
    const ra = T.pressure(tree, null)
    lines.push('【外置大脑 · 预算（整件事能探究多少）】')
    lines.push(`  总量 ${ra.cap}｜任务已分 ${ra.used}｜余 ${ra.left}`)
    lines.push('  · 预算不够 = **继续推进的出口，不是停的理由**：')
    lines.push('    ① `brain_task root_budget:N` 提高总量（说清为什么整件事值这么多）')
    lines.push('    ② 回根重分配：`brain_task` 给「现在不做」的降权（`brain_back` 已于 2026-10-19 下线，别再调）')
    lines.push('  · ⚠️ 停的**出口**是：任务达成，或任务不可达（指名缺哪个外部条件）。')
    lines.push('    预算 / 上下文 / 累了都不是停的理由——**反证**：拿它们停，交付账照样欠着，等于没做完。')
  }
  lines.push('### L1 任务（你的话 · 权重最高 · 给定）')
  if (tasks.length) {
    for (const t of tasks) {
      const dep = (t.deps || []).length ? ` ← 依赖 ${t.deps.join('、')}` : ''
      const conf = (t.conflicts || []).length ? ` ⚔ 与 ${t.conflicts.join('、')} 互斥` : ''
      const yld = t.yield_to ? ` ⇢ 已让位给 ${t.yield_to}（代价：${t.cost || '⚠️未写'}）` : ''
      const wt = `（权重 ${t.weight}）`
      const retake = t.need_retake ? ' 【🟠需重取】' : ''
      lines.push(`- ${t.id}${wt} ${t.text}${dep}${conf}${yld}${retake}${evTag(t)}`)
      const a = T.pressure(tree, t.id)
      if (a.cap > 0 && (a.kids.length || a.cap)) {
        lines.push(`    · 取用额度 ${a.used}/${a.cap}｜余 ${a.left}｜已取 [${a.kids.join(',') || '无'}]`)
      }
    }
  } else lines.push('- （无 —— 尚未声明任务；「任务」是你的原话，权重最高、不许漂）')
  lines.push('')

  {
    const pl = st.plan || P.newPlan()
    const all = P.deliveryAll(pl, tree.tasks)
    const ids = Object.keys(all)
    lines.push('### 交付账（里程碑 · 你自己拆、自己改 · 完成只由判据判）')
    if (!ids.length) {
      lines.push('- （树上没有用户任务，无从拆解）')
    } else if (!ids.some((k) => all[k].hasPlan)) {
      lines.push('- 🔴 **有任务无计划**：' + ids.join('、') + ' 一个里程碑都没有。')
      lines.push('  ⇒ 出口：`brain_plan action:"put"` 先把**最重那条任务**拆出 1~3 个里程碑'
        + '（每个必须有 `output` 交付物 + `done_when` 判据）。宁可粗，不可空。')
    } else {
      for (const tid of ids) {
        const d = all[tid]
        if (!d.hasPlan) { lines.push(`- ${tid} — 无计划（未拆解）`); continue }
        const pct = (d.progress * 100).toFixed(0)
        lines.push(`- ${tid} — ${d.done}/${d.total} 里程碑 · 进度 ${pct}%（按权重）`)
        for (const m of Object.values(pl.milestones).filter((x) => x.task === tid)) {
          const mark = m.status === 'done' ? '✅' : (m.status === 'failed' ? '❌' : '⬜')
          const vN = (m.evidence || []).length
          const crit = m.done_when?.mode === 'cmd'
            ? `cmd "${String(m.done_when.cmd).slice(0, 60)}"`
            : `evidence ${(m.done_when?.artifacts || []).length} 件`
          lines.push(`    ${mark} ${m.id} ${m.text}｜交付物：${m.output}｜判据：${crit}`
            + `｜${vN ? `已验 ${vN} 次` : '**从未验过**'}`)
          const lastJury = (m.evidence || []).slice(-1)[0]?.jury
          if (lastJury && lastJury.decision && !(lastJury.decision === 'pass' && lastJury.unanimous)) {
            lines.push(`      ↳ ${J.juryLine(lastJury)}`)
          }
        }
      }
    }
    const dl = P.deliveryLine(pl, tree.tasks)
    if (dl) {
      lines.push(`· ${dl}`)
      lines.push('· 判据没绿之前，说「做了几件」不构成完成。'
        + '交付账是**活的**：发现新情况就 `brain_plan action:"put"` 改（改判据会让它回 pending 并留痕）；'
        + '判据要跑就 `brain_verify`（唯一把里程碑判绿的入口）。')
    }
  }
  lines.push('')
  lines.push('### L2 子问题（取的矛盾 · 权重=取的理由 · critical×2）')
  if (questions.filter((q) => !mbIds.has(q.id)).length) {
    for (const q of questions) {
      if (mbIds.has(q.id)) continue
      const crit = q.critical ? '【关键路径】' : ''
      const p = q.parent ? ` → 挂 ${q.parent}` : ''
      lines.push(`- ${q.id} ${q.text}（权重 ${q.weight}）${crit}${p}${evTag(q)}`)
      lines.push(`    · 取的理由：${q.why}`)
    }
  } else lines.push('- （无）')
  lines.push('- 权重怎么用：子从父额度里分（默认分走余量的一半）⇒ 越深越轻。'
    + '在深处忙不算错，但排序上**永远压不过上层没动的那条**；额度分光就等于「取到取不动了」，'
    + '再取必须先砍一条（取舍）。')
  for (const l of T.treeSummary(tree)) lines.push(`- ${l}`)
  lines.push('')
  lines.push(`### L2′ 机制自身的边界 ｜ 口径=**自指**（撞墙长出来的，不是想出来的）`)
  if (mbAll.length) {
    for (const q of mbAll) {
      lines.push(`- ${q.id} ${q.text}（权重 ${q.weight}）`)
      lines.push(`    · 撞墙证据：${q.why}`)
    }
  } else {
    lines.push('- （0 条 —— 不是「没有边界」，是**还没被发现**；发现只能靠撞墙）')
  }
  lines.push('')

  lines.push('### L2″ 矛盾树（层 · 取生的子矛盾 / 上爬路径）')
  try {
    for (const l of CN.renderContra(st.contra, 8, st.ob)) lines.push(`- ${l}`)
  } catch (error) {
    lines.push(`- （读不出矛盾树：${String(error).slice(0, 60)}）`)
  }
  lines.push('')

  lines.push('### L2‴ 信念账（每条"要负责的话"的当前水位 · 换人先读这里）')
  try {
    const all = Object.values(st.beliefs || {}).filter((b) => b.id !== 'M-必答已交')
    if (!all.length) {
      lines.push('- （0 条 —— 不是"没有疑问"，是**还没人给任何话下过先验**）')
    } else {
      const alive = all.filter((b) => b.status === 'alive')
      const dead = all.filter((b) => b.status !== 'alive')
      const low = [...alive].sort((a, b) => (a.p ?? 0.5) - (b.p ?? 0.5)).slice(0, 3)
      for (const b of low) {
        const contra = (b.n_contra || 0) > 0 ? `，反证 ${b.n_contra} 票` : ''
        const last = (b.hist || []).slice(-1)[0]
        lines.push(`- p=${Number(b.p).toFixed(2)} ${b.id} 「${String(b.claim).slice(0, 46)}」${contra}`
          + `${last?.why ? `（最近：${String(last.why).slice(0, 30)}）` : ''}`)
      }
      if (dead.length) {
        lines.push(`- 已判死 ${dead.length} 条：${dead.map((b) => b.id).slice(0, 4).join('、')}`
          + ' ⇒ 它们支撑的那次「取」已作废，别拿它们的结论往下走')
      }
      const lo = alive.length ? Number(Math.min(...alive.map((b) => b.p ?? 1))).toFixed(2) : '-'
      lines.push(`- （共 ${all.length} 条活命题；最低 ${lo}`
        + `；⚠️ p<${BL.P_FLOOR} 且两票反证 ⇒ 该回到空）`)
    }
  } catch (error) {
    lines.push(`- （读不出信念账：${String(error).slice(0, 60)}）`)
  }
  lines.push('')

  lines.push('### L2⁗ 隐患账（被推走的矛盾 · 到期必须结，不许挂着装死）')
  try {
    const hz = Object.values(st.hazards?.items || {})
    const open = hz.filter((h) => h.status === 'open')
    if (!open.length) {
      lines.push(hz.length
        ? `- （open 0 条；已结 ${hz.length} 条 —— fired ${hz.filter((h) => h.status === 'fired').length} / accepted ${hz.filter((h) => h.status === 'accepted').length}）`
        : '- （0 条 —— 不是"没有隐患"，是**还没停止过任何一次取**；停手与转移都必须挂账）')
    } else {
      for (const h of open.slice(0, 4)) {
        lines.push(`- ${h.id} 「${String(h.what || '').slice(0, 40)}」｜${String(h.where || '').slice(0, 30)}`
          + `｜回来条件「${String(h.fire_when || '（未写）').slice(0, 34)}」`)
      }
      if (open.length > 4) lines.push(`- ……另有 ${open.length - 4} 条未列`)
      lines.push(`- （共 ${hz.length} 条：open ${open.length} / fired ${hz.filter((h) => h.status === 'fired').length}`
        + ` / accepted ${hz.filter((h) => h.status === 'accepted').length}）`)
    }
  } catch (error) {
    lines.push(`- （读不出隐患账：${String(error).slice(0, 60)}）`)
  }
  lines.push('')

  lines.push('### L3 矩阵 / 动作（该做什么 · 分发）')
  lines.push('')
  const all = collectAll(pool.entries, null, cfg.ledger)
  const [chosen, dropped] = C.take(all, cfg.cap, graph.debt, T.weightMap(st.tree, pool))

  const covered = new Set(chosen.map((o) => o.rid))
  const debt = liveDebts(st, cfg)
  const pending = debt.live.filter((t) => !covered.has(t.src) && !covered.has(t.id))

  const wm = T.weightMap(st.tree, pool)
  lines.push(`### ① 步层额度 ｜ 口径=**按步**（每步重算，受 CAP）｜ CAP=${cfg.cap}，本段 ${chosen.length} 条`)
  if (chosen.length) {
    for (const o of chosen) {
      const how = { OBSERVE: '补观测', RERUN: '复核', LIFT: '升维', SPLIT: '降维', EITHER: '升降维' }[o.op] ?? o.op
      const k = o.k ?? 1
      const wtxt = wm[o.rid] ? `权重 ${wm[o.rid]}` : '⚠️散卡·未挂树'
      lines.push(`- [${o.op}·${how}] ${o.rid}（${wtxt}）${k > 1 ? `（${k} 条同形，一次覆盖）` : ''}：${o.tag}`)
    }
  } else lines.push('- （无）')
  lines.push('')
  lines.push(`### ② 跨轮待办 ｜ 口径=**图层**（跨轮累积，**不受 CAP**）｜ 但受**水位闸**：本段 ${pending.length} / ${debt.cap} 条`)
  if (pending.length) {
    for (const t of pending) {
      const how = { review: '复核', observe: '补观测', split: '降维', lift: '升维' }[t.kind] ?? '待办'
      lines.push(`- [${how}] ${t.id}：${t.title}${t.done_when ? `（做完判据：${t.done_when}）` : ''}`)
    }
  } else lines.push('- （无）')
  if (debt.raw !== pending.length) {
    lines.push(`- ⚠️ 账目澄清：账上原有 ${debt.raw} 条 ⇒ 归并同名矛盾 ${debt.merged.length} 条`
      + `（同一 src 的复核/升维/降维是**同一件事的三条路径**，只派最高优先的一条）`
      + `、源已消失销账 ${debt.dissolved.length} 条`
      + `、超水位暂不派 ${debt.overflow.length} 条（**机制自治：是机制派生过量，不是你的欠账**）`)
  }
  const lp0 = st.lift_pending || []
  if (lp0.length) {
    lines.push('')
    lines.push(`### ②′ 升维回执 ｜ 口径=**跨轮欠账**（升维是取，必须回执）｜ ${lp0.length} 条`)
    for (const p of lp0) {
      const tgt = (p.targets || []).length ? ` ⇒ 报树节点 ${p.targets.join('、')}` : ''
      const agg = p.stuck ? `【🔴 超期 ${p.n} 轮】` : (p.n > 1 ? `（挂 ${p.n} 轮）` : '')
      lines.push(`- ${p.rid}${agg}：旧矛盾消失了没有？`
        + '（**dissolved** 消失⇒子树一并失去理由 / **transformed** 变形⇒必给去向 / **still** ⇒ 这次升维是执）' + tgt)
    }
    lines.push('- 机制每轮已**自动结算一次**：只给了新变量（`new_vars ≠ ∅`）才需要你回执三态；'
      + '新变量集与旧层相同 ⇒ 机制自动判「执」（still），不用你报。'
      + '**把变量集写回**用 `brain_lift_check`（带 `rid`）—— 只判不写回 ⇒ 机制仍算你欠回执。')
  }
  if (!chosen.length && !pending.length && !lp0.length) {
    lines.push('')
    lines.push('## 当前无该做的问题 —— 但**必须连读下面的口径披露**，否则这句话没有信息量')
  }
  lines.push('')
  lines.push('### ③ 口径披露（缺了它，「无该做的问题」可以是「我没在看」）')
  lines.push(`- 池：${Object.keys(pool.entries).length} 条 ｜ agent 已认账 ${(pool.rounds || []).length} 轮`
    + `（**不是轮数**；轮的权威计数见下面矩阵口径）｜ 账本：${cfg.ledger}`)
  if (!Object.keys(pool.entries).length) {
    lines.push('- 🔴 **池中 0 条** ⇒ 不是"没问题"，是**没在观测**'
      + '（证据只能由 brain_observe 进来；没有装置侧喂食者 ⇒ 池子必然空）')
  }
  for (const l of M.matrixSummary(st.matrix || M.newMatrix(), pool, null, st)) lines.push(`- ${l}`)
  {
    const mv = M.matrixView(st.matrix || M.newMatrix())
    const s = mv.summary
    if (mv.whole.to > 0) {
      lines.push(`- 三层全景：L1 ${mv.layers.L1.n} 行 / L2 ${mv.layers.L2.n} 段 / L3 窗口 ${mv.layers.L3.window} 段`
        + `（覆盖第 ${mv.whole.from} → 第 ${s.covered} 步）`
        + (mv.whole.gap > 0
          ? `；⚠️ 第 1 → 第 ${mv.whole.gap} 步**不在视野里**（更早的段已滚出窗口，不是"没发生"）`
          : ''))
      const lost = [...mv.layers.L1.lost, ...mv.layers.L2.lost, ...mv.layers.L3.lost]
        .filter((x) => x.dropped > 0)
      if (lost.length) {
        lines.push(`- ⚪ 投影留损：${LD.lossLine(lost)}`
          + ' ⇒ **上面每一层的数都是被压过的**：段层看不到全部明细，项目层只看得到最近几段。'
          + ' 说"某件事没发生过"之前，先确认它不是被压掉的那部分。')
      }
      if (s.brokenLinks > 0) {
        lines.push(`- 🟠 包含链断了 ${s.brokenLinks} 处 ⇒ 有 ${s.brokenLinks} 段连"它包含哪几轮"都没记下来，点不回步层`)
      }
    }
  }
  for (const l of M.reviewLights(pool)) lines.push(`- ${l}`)

  if (dropped.length) {
    lines.push('')
    lines.push(`## 本节放下 ${dropped.length} 件（取舍，非丢弃；饿死优先轮转）`)
    for (const d of dropped) lines.push(`- ${d.rid}：${d.abandoned}`)
  }

  lines.push('')
  lines.push('---')
  lines.push('### 附录 · 六种常规做法（分水岭：变量集合动没动）')
  lines.push('补观测/复核/拆解：变量集合不动；**升维 LIFT：新增变量**；取舍/知止：不动。')
  lines.push('> ⚠️ 如实披露：盘上的 `LIFT` 判据是「`new_vars ≠ ∅`」—— 它只做到**多引入一个变量**，')
  lines.push('>   还够不上"上升到那条被侵犯的不变量"（后者是意象，没有可执行判据，见 `dsh/terms.mjs` 的 `升维`）。')
  lines.push('>   所以别把 `op:"lift"` 当成"我已经升维了"：它只是"我多考虑了一个变量"，处置办法未必变得可复用。')
  lines.push('> **边界**：机制只判「该不该报警、该做哪件」这类**可判定**的事；'
    + '事实断言仍需你自己核对，类别跨越（改判）必须走 Q0~Q3 给理由。')
  return lines.join('\n')
}

export function liveDebts(st, cfg) {
  const tasks = (st.graph || {}).tasks || {}
  const entries = (st.pool || {}).entries || {}
  const RANK = { review: 0, lift: 1, split: 2, observe: 3 }
  const wm = T.weightMap(st.tree, st.pool || {})

  const all = Object.values(tasks).filter((t) => t.status === 'pending' && t.executable)

  const dissolved = all.filter((t) => !(t.src in entries)).map((t) => t.id)

  const best = new Map()
  const merged = []
  for (const t of all) {
    if (!(t.src in entries)) continue
    const r = RANK[t.kind] ?? 9
    const cur = best.get(t.src)
    if (!cur || r < cur.r || (r === cur.r && t.id < cur.t.id)) {
      if (cur) merged.push({ id: cur.t.id, src: t.src, into: t.id })
      best.set(t.src, { t, r })
    } else merged.push({ id: t.id, src: t.src, into: cur.t.id })
  }

  const alive = [...best.values()].map((x) => x.t)
    .sort((a, b) => (Number(wm[b.src] ?? 1) - Number(wm[a.src] ?? 1)) || (a.id < b.id ? -1 : 1))
  const cap = cfg.openDebt ?? C.BUDGET.open_debt
  const live = alive.slice(0, cap)
  const overflow = alive.slice(cap)

  return { live, overflow, dissolved, merged, raw: all.length, cap }
}

export function briefHasWork(st, cfg) {
  const { pool, graph } = st
  const all = collectAll(pool.entries, null, cfg.ledger)
  const [chosen] = C.take(all, cfg.cap, graph.debt, T.weightMap(st.tree, pool))
  const d = liveDebts(st, cfg)
  return {
    chosen: chosen.length, pending: d.live.length, hasWork: chosen.length > 0 || d.live.length > 0,
    overflow: d.overflow.length, merged: d.merged.length, dissolved: d.dissolved.length,
  }
}

export function debtLevel(st, cfg) {
  const w = briefHasWork(st, cfg)
  const unresolved = Object.values((st.pool || {}).entries || {}).filter(
    (e) => (e.challenge || 0) > 0 && (e.chal_since_review ?? 0) > 0,
  ).length
  return w.chosen + w.pending + unresolved
}

export const B1 = 'B1·拦的是谁'
export const B2 = 'B2·拦了还动得了吗'
export const B3 = 'B3·判据是绝对量吗'

export function boundaryGuard(action) {
  const a = action || {}
  if (a.target === 'user') {
    return { ok: false, violated: B1, reason: '拦到用户输入 = 机制否决旨意（TASK_WEIGHT=100）' }
  }
  const restricting = a.kind === 'block' || a.kind === 'deny'
  if (restricting && (!Array.isArray(a.exits) || a.exits.length === 0)) {
    return { ok: false, violated: B2, reason: '封锁且无出口 = 死锁（被拦后无法还账）' }
  }
  if (restricting && a.criterion === 'absolute') {
    return { ok: false, violated: B3, reason: '绝对量判据会自噬（历史欠账天然不降 ⇒ 把「在干活」判成「在漂移」）' }
  }
  return { ok: true, violated: null, reason: '' }
}

export function absorbBoundary(st, cfg, sig) {
  const tree = st.tree || (st.tree = T.newTree())
  T.ensureMeta(tree)
  const raw = String(sig?.kind || sig?.text || '').trim()
  if (!raw) return { ok: false, why: '边界信号缺 kind/text —— 没有稳定身份，幂等会失效（同类信号无法去重）' }
  const id = `B-${raw.slice(0, 24)}`
  const prev = tree.questions[id]
  if (prev) {
    return { ok: false, id, why: `边界 ${id} 已存在（status=${prev.status}）—— 机制不自动复活，要重取请人判` }
  }
  const why = String(sig.why || sig.detail || `撞墙信号：${raw}`)
  const r = T.takeBoundary(tree, { id, text: String(sig.text || raw), why, critical: !!sig.critical })
  return { ok: r.ok, id, why: r.ok ? '' : r.why }
}

export function clearLiftPending(st, id, result) {
  const tree = st.tree || {}
  const node = (tree.questions || {})[String(id)] || (tree.tasks || {})[String(id)]
  const covered = new Set([...(node?.rids || []), String(id), ...((result && result.invalidated) || [])])
  st.lift_pending = (st.lift_pending || []).filter((p) => !covered.has(p.rid))
  return st.lift_pending
}

export function writeLiftClaim(st, cfg, rid, { vars = [], oldVars = [], claim = '', lift = null } = {}) {
  const key = String(rid)
  const task = (st.graph?.tasks || {})[`L-${key}`]
  if (!task) return { ok: false, why: `找不到升维任务 L-${key} —— rid 错了，或这条升维不在账上` }
  task.variables = vars.slice()
  task.old_variables = oldVars.slice()
  task.claim = String(claim || '')
  if (lift) {
    task.lift_grade = String(lift.grade || '')
    task.lift_way = lift.way ? String(lift.way) : null
    task.lift_source = lift.source ? JSON.parse(JSON.stringify(lift.source)) : null
    task.lift_note = String(lift.note || lift.why || '')
  }
  const sl = settleLifts(st, cfg, {})
  return {
    ok: true, rid: key,
    autoStill: sl.still.includes(key),
    awaitingReceipt: sl.take.some((x) => x.rid === key),
    hold: (sl.hold || []).includes(key),
    remaining: (st.lift_pending || []).length,
  }
}

export function settleLifts(st, cfg, { turn = null } = {}) {
  const tree = st.tree || (st.tree = T.newTree())
  const graph = st.graph || {}
  const ttl = cfg.liftTtl ?? 3
  const report = { still: [], take: [], noClaim: [], stuck: [], cleared: [], ttl }

  for (const p of st.lift_pending || []) {
    const rid = String(p.rid)
    const task = (graph.tasks || {})[`L-${rid}`]
    const vars = Array.isArray(task?.variables) ? task.variables : []
    const oldVars = Array.isArray(task?.old_variables) ? task.old_variables : []
    const nv = C.newVars(vars, oldVars)
    const live = T.findByRid(tree, rid).filter((n) => !T.GONE_STATUSES.includes(n.status))

    p.targets = live.map((n) => n.id)

    if (!vars.length) {
      if (turn !== null && p.lastTurn !== turn) { p.n = (p.n || 0) + 1; p.lastTurn = turn }
      p.n = p.n || 1
      if (p.n >= ttl) { p.stuck = true; report.stuck.push(rid) } else { p.stuck = false; report.noClaim.push(rid) }
      continue
    }
    if (!nv.length) {
      p.settled = 'still'
      p.stuck = false
      for (const n of live) {
        T.dissolveSubtree(tree, n.id, {
          verdict: 'still',
          note: `自动判假：新变量集与旧层相同（${vars.join('、')}）⇒ 换了说法没换层`,
        })
      }
      if (task) { task.lift_diag = 'still'; task.lift_fake = true }
      report.still.push(rid)
      continue
    }
    if (task && task.lift_grade === 'none') {
      p.settled = 'still'
      p.stuck = false
      for (const n of live) {
        T.dissolveSubtree(tree, n.id, {
          verdict: 'still',
          note: '自动判假：有新变量、但未说明用哪种手段（ladder/restate/separate/counter）'
            + ' ⇒ 视为在同一层加了一项；补上 `way` 可再判一次',
        })
      }
      task.lift_diag = 'still'
      task.lift_fake = true
      report.still.push(rid)
      continue
    }
    if (task && task.lift_grade === 'blank') {
      p.stuck = false
      p.hold = true
      task.lift_diag = 'hold'
      report.hold = (report.hold || []).concat([rid])
      continue
    }
    p.stuck = false
    if (task) { task.lift_diag = 'take'; task.new_vars = nv }
    report.take.push({ rid, newVars: nv })
  }

  const before = (st.lift_pending || []).length
  st.lift_pending = (st.lift_pending || []).filter((p) => p.settled !== 'still')
  report.cleared = new Array(before - st.lift_pending.length).fill('still')
  return report
}

export async function probeJevHealth(st, cfg = {}) {
  const now = Date.now()
  if (st._jevHealth && now - (st._jevHealth.at || 0) < 30000) return st._jevHealth.v
  if (!cfg?.jevEndpoint) {
    st._jevHealth = { at: now, v: { status: 'not-configured' } }
    return st._jevHealth.v
  }
  const endpoint = String(cfg.jevEndpoint)
  let v
  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: cfg?.jevModel || 'default',
        state: 'health probe',
        questions: { ok: { type: 'noul', instructions: 'Is this reachable?' } },
      }),
      signal: AbortSignal.timeout(2500),
    })
    v = { status: r.ok ? 'up' : `http ${r.status}` }
  } catch (e) {
    v = { status: `down（${String(e.name || e.message || e).slice(0, 24)}）` }
  }
  if (v.status !== 'up') {
    v.fix = {
      what: '配置的外部决策层服务不可达 ⇒ brain_task 里的 jev_ask 不会出现',
      cmd: cfg?.jevStartCmd || null,
      then: '服务恢复后 brain_status.jev_health 会在 30 秒内变 up',
      dont: '不要读成「机制不支持」——这是可选外部服务没起，不影响其它工具',
    }
    if (!v.fix.cmd) delete v.fix.cmd
  }
  st._jevHealth = { at: now, v }
  return v
}

export function hardDirective(st, cfg, stallStreak = 0) {
  if (cfg && cfg.lean === true) {
    const reds = T.treeLights(st.tree || T.newTree()).filter((l) => l.startsWith('🔴'))
    if (!reds.length) return { severity: 'none', lines: [], reason: '' }
    return { severity: 'hard', stallStreak, lines: reds, reason: `【外置大脑 · lean 模式】只有结构红灯会说话：\n${reds.join('\n')}` }
  }
  const leanSelect = !!(cfg && cfg.leanSelect === true)
  const w = briefHasWork(st, cfg)
  const lights = T.treeLights(st.tree || T.newTree())
  const red = lights.filter((l) => l.startsWith('🔴'))
  const retake = lights.filter((l) => l.includes('need_retake'))
  const unresolved = Object.values((st.pool || {}).entries || {}).filter(
    (e) => (e.challenge || 0) > 0 && (e.chal_since_review ?? 0) > 0,
  ).length

  const lines = []
  if (red.length) {
    lines.push('🔴 结构红灯（树的边坏了，必须立刻处置）：')
    lines.push(...red.map((l) => `  ${l}`))
  }
  if (retake.length) {
    lines.push('🟠 需重取（退回后父节点未重新取 → 回到空）：')
    lines.push(...retake.map((l) => `  ${l}`))
  }
  const HOW = { OBSERVE: '补观测', RERUN: '复核', LIFT: '升维', SPLIT: '降维', EITHER: '升降维' }
  const KINDTXT = { review: '复核', observe: '补观测', split: '降维', lift: '升维' }
  const trunc = (s, n = 42) => (String(s || '').length > n ? `${String(s).slice(0, n)}…` : String(s || ''))

  const dAll = liveDebts(st, cfg)
  const overCap = dAll.overflow.length > 0 || dAll.live.length > Number(dAll.cap || cfg.cap || 8)
  const chosenOps = C.take(
    collectAll((st.pool || {}).entries || {}, null, cfg.ledger),
    cfg.cap, (st.graph || {}).debt, T.weightMap(st.tree, st.pool || {}),
  )[0]
  if (!leanSelect) {
    if (overCap) {
      lines.push(`· 账已堆到水位：待办 ${dAll.live.length} 条 / 水位 ${dAll.cap}（另有 ${dAll.overflow.length} 条超水位暂不派）`)
      lines.push('  **机制不替你挑**：清单用 `brain_status` 看全量，你自己决定先做哪条 —— 这是提醒，不是派活。')
    } else if (w.chosen > 0) {
      lines.push(`· 待办 ${w.chosen} 件（步层欠账，水位内）—— 按序挑，不必全做：`)
      chosenOps.forEach((o, i) => {
        lines.push(`  ${i + 1}. [${o.op}·${HOW[o.op] ?? o.op}] ${o.rid}：${trunc(o.tag)}`)
      })
    }
  }
  const pendingList = dAll.live.filter((t) => !chosenOps.some((o) => o.rid === t.src || o.rid === t.id))
  if (!leanSelect && pendingList.length) {
    lines.push(`· 跨轮待办 ${pendingList.length} 件（水位内；步层之外的存量）—— 按序挑，不必全做：`)
    pendingList.slice(0, 3).forEach((t, i) => {
      lines.push(`  ${i + 1}. [${KINDTXT[t.kind] ?? '待办'}] ${t.id}${t.done_when ? `（判据：${trunc(t.done_when, 30)}）` : ''}`)
    })
    if (pendingList.length > 3) lines.push(`  …另有 ${pendingList.length - 3} 件，用 \`brain_status\` 看全量`)
  }
  {
    const parts = []
    if (dAll.merged.length) parts.push(`同名归并 ${dAll.merged.length}`)
    if (dAll.dissolved.length) parts.push(`源消失销账 ${dAll.dissolved.length}`)
    if (parts.length) lines.push(`· 账目：账上原有 ${dAll.raw} 条 ⇒ ${parts.join('、')}（机制自治，不是你的欠账）`)
  }
  if (unresolved > 0) lines.push(`· 池中 ${unresolved} 条反证未复核（欠账口径，拖越久漂越远）`)
  const mq = T.metaQuestions(st.tree || T.newTree())
  if (mq.length) {
    lines.push(`· 机制自身已取的边界 ${mq.length} 条：${mq.map((q) => q.id.replace(/^B-/, '')).join('、')}`
      + '（⚠️ 加压/封锁前先自查这几条 —— 它们是撞墙撞出来的，不是想出来的）')
  }
  const lp = st.lift_pending || []
  const lpStuck = lp.filter((p) => p.stuck)
  const lpPending = lp.filter((p) => !p.stuck)
  if (lpStuck.length) {
    lines.push(`🔴 升维回执超期 ${lpStuck.length} 条（挂满 ${cfg.liftTtl ?? 3} 轮仍未回执）：`
      + `${lpStuck.map((p) => p.rid).join('、')}`
      + ' —— 升维没回执 = **假装完成**，旧矛盾还挂在树上报欠账。'
      + '用 `brain_lift_check`（带 `rid` 参数）把新层变量集写回 ⇒ 机制**当场**自动判「取/执」；'
      + '若判「取」，再用 `brain_dissolve` 回答 dissolved / transformed / still。')
  }
  if (lpPending.length) {
    lines.push(`🟠 升维待回执 ${lpPending.length} 条：${lpPending.map((p) => p.rid).join('、')}`
      + ' —— 升维是「取」，必须回答「旧矛盾消失了没有」：'
      + '**dissolved**（消失⇒整棵子树失去理由，一并消解）/ **transformed**（只换位置⇒必须记去向，终将反弹）/ '
      + '**still**（原样还在⇒**这次升维是执**，新变量没进这条矛盾的判据）。用 brain_dissolve 回执。')
  }

  if (lines.length) {
    const ah = T.aimHint(st.matrix, st.tree)
  if (!leanSelect) {
    try {
      const tick = FLOW.tick(st, {
        steps: (st.recent_steps || []).slice(-8),
        budget: { budgetUsed: Number(cfg?.budgetUsed || 0), budgetTotal: Number(st.tree?.budget || 100) },
        cfg: { unknownWaterline: cfg?.unknownWaterline },
      })
      if (tick.agg && tick.agg.line) lines.push(`· ${tick.agg.line}`)
      else if (tick.brief) lines.push(tick.brief)
      if (tick.loop === FLOW.LOOP.OUTER) diag({ ...cfg, workDir: cfg?.workDir || st?.workDir || process.cwd() }, `flow outer ${tick.outerReasons.length} reasons`)
    } catch (e) {
      diag({ ...cfg, workDir: cfg?.workDir || st?.workDir || process.cwd() }, `flow 失败 ${String(e.message || e).slice(0, 60)}`)
    }
  }
  }

  if (!lines.length) {
    const ch = T.commandHint(st.tree?.tasks, st.last_user_text)
    if (ch.line) {
      return { severity: 'notice', stallStreak, lines: [ch.line], reason: `【外置大脑 · 口令】\n${ch.line}` }
    }
    return { severity: 'none', lines, reason: '' }
  }

  lines.push('· 收尾判据：**账勾完 ≠ 做完** —— 真判据是「用户要我做的那几件，哪几件成了可核事实（命令/URL/文件/截图）」，没成的写明差什么。')
  lines.push('  只报"这轮做了几件"、或拿预算/上下文/累了当理由 ⇒ 都算未完成（预算不够走 `brain_task root_budget:N`）。')

  const structural = red.length > 0 || retake.length > 0 || lpStuck.length > 0
  const hard = structural || w.chosen > 0
  const ignored = stallStreak >= (cfg.stallLimit ?? 5)
  return {
    severity: ignored ? 'ignored' : (hard ? 'hard' : 'notice'),
    stallStreak,
    lines,
    reason: (stallStreak > 0
      ? `【外置大脑 · 硬指令】以下欠账已连续 ${stallStreak} 轮下发、未被 brain_* 回应：\n`
      : '【外置大脑 · 硬指令】以下欠账待处置（本轮首次下发，尚未判定是否被回应）：\n') + lines.join('\n'),
  }
}

let _diagRef = null
export function bindDiagRef(cfg) { _diagRef = cfg }

function scanUndefined(v, path = '', hits = []) {
  if (Array.isArray(v)) v.forEach((x, i) => scanUndefined(x, `${path}[${i}]`, hits))
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      const p = path ? `${path}.${k}` : k
      if (x === undefined) hits.push(p)
      else scanUndefined(x, p, hits)
    }
  }
  return hits
}

function stripUndefined(v) {
  if (Array.isArray(v)) return v.map(stripUndefined)
  if (v && typeof v === 'object') {
    const o = {}
    for (const [k, x] of Object.entries(v)) o[k] = x === undefined ? null : stripUndefined(x)
    return o
  }
  return v
}

function messageText(m) {
  if (!m) return ''
  if (typeof m === 'string') return m
  const c = m.content ?? m.message?.content ?? m.text
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c.map((x) => (typeof x === 'string' ? x : (x?.text ?? ''))).filter(Boolean).join('\n')
  }
  return ''
}

function lastUserText(messages) {
  if (!Array.isArray(messages)) return ''
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]
    if (!m || m.role !== 'user') continue
    const form = m.source?.form ?? m.form
    if (form === 'notice') continue
    const t = messageText(m)
    if (t) return t
  }
  return ''
}

function jsonOutput(schema) {
  return {
    schema,
    render(_a, v) {
      const hits = scanUndefined(v)
      if (hits.length) {
        const line = `toolOutput undefined→null (${hits.length}): ${hits.slice(0, 8).join(', ')}`
        if (_diagRef) diag(_diagRef, line)
        else console.warn(`[${name}] ${line}`)
      }
      return [{ type: 'text', text: JSON.stringify(stripUndefined(v), null, 2) }]
    },
  }
}
const OPEN_OBJ = { type: 'object', additionalProperties: true }

function injectedMessage(text) {
  return Object.freeze({
    id: globalThis.crypto.randomUUID(),
    role: 'user',
    source: Object.freeze({ kind: name }),
    content: Object.freeze([Object.freeze({ type: 'text', text })]),
  })
}

export function hardNotice(lines, summary) {
  return Object.freeze({
    id: globalThis.crypto.randomUUID(),
    role: 'user',
    source: Object.freeze({ kind: name, form: 'notice', summary: summary || '外置大脑·硬指令' }),
    content: Object.freeze([Object.freeze({ type: 'text', text: lines.join('\n') })]),
  })
}

function defaultPhilosophyFile() {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    return resolve(here, '..', 'PHILOSOPHY.md')
  } catch {
    return null
  }
}

const REGISTERED_TOOLS = new Set()

export function registeredTools() { return [...REGISTERED_TOOLS].sort() }

export function _resetRegisteredTools() { REGISTERED_TOOLS.clear() }

export function auditRefs(text, registered = null) {
  const real = new Set(registered || [...REGISTERED_TOOLS])
  const claimed = [...new Set(
    [...String(text || '').matchAll(/\bbrain_([a-z][a-z0-9_]*)/gi)].map((m) => `brain_${m[1]}`),
  )].filter((n) => {
    const tail = n.slice('brain_'.length)
    return new Set(tail).size > 1
  })
  const ghost = claimed.filter((n) => !real.has(n)).sort()
  const unused = [...real].filter((n) => !claimed.includes(n)).sort()
  return { claimed, ghost, unused, ok: ghost.length === 0, known: real.size }
}

export function readPhilosophy(cfg) {
  const file = (cfg && cfg.philosophyFile) || defaultPhilosophyFile()
  if (!file) return { ok: false, file: null, chars: 0, text: '', sha: null, why: '无法解析插件目录（import.meta.url 不可用）' }
  try {
    if (!existsSync(file)) return { ok: false, file, chars: 0, text: '', sha: null, why: '文件不存在' }
    let text = String(readFileSync(file, 'utf8'))
    if (!text.trim()) return { ok: false, file, chars: 0, text: '', sha: null, why: '文件为空' }
    {
      const coreFile = resolve(dirname(file), 'DESIGN-CORE.md')
      if (existsSync(coreFile)) {
        const core = String(readFileSync(coreFile, 'utf8')).trim()
        if (core) text = text.trimEnd() + '\n\n---\n\n' + core + '\n'
      }
    }
    {
      const defsFile = resolve(dirname(file), 'FORMAL-DEFS.md')
      if (existsSync(defsFile)) {
        const defs = String(readFileSync(defsFile, 'utf8')).trim()
        if (defs) text = text.trimEnd() + '\n\n---\n\n' + defs + '\n'
      }
    }
    const sha = createHash('sha256').update(text).digest('hex').slice(0, 16)
    return { ok: true, file, chars: text.length, text, sha, why: '' }
  } catch (e) {
    return { ok: false, file, chars: 0, text: '', sha: null, why: `读取失败：${String((e && e.message) || e)}` }
  }
}

export function refsAudit(ph, registered = null) {
  if (!ph || !ph.ok || !ph.text) return null
  return auditRefs(ph.text, registered)
}

export function refsWarning(a) {
  if (!a || a.ok) return []
  return [
    `🔴 **本文引用了不存在的工具：${a.ghost.join('、')}** —— 你现在调不到它。`
      + '这不是"以后再实现"，是**当下这条指向空气**（已注册 '
      + `${a.known} 个工具，本文引用 ${a.claimed.length} 个，其中 ${a.ghost.length} 个查无此工具）。`,
    '出口二选一（不处置则每次加载都会重复这一行）：'
      + '① 把那一条改写成真实存在的工具（欠账/状态类用 `brain_status`，交付里程碑用 `brain_plan action:"list"`）；'
      + '② 真要这个工具，就先加工具、再写文档。'
      + '**在你改之前：本文里凡指向上述名字的句子，一律按"没有这条通路"处理，不许拿它当借口空转。**',
  ]
}

export function refsDiag(a) {
  if (!a) return 'refs=-'
  return a.ok
    ? `refs=OK claimed=${a.claimed.length} known=${a.known}`
    : `refs=GHOST(${a.ghost.join('|')}) claimed=${a.claimed.length} known=${a.known}`
}

export function philosophyBlock(ph, audit = null) {
  const a = audit === null ? refsAudit(ph) : audit
  const head = [
    '【外置哲学 · 已加载】这份是**判断方法**（怎么看 / 怎么想 / 怎么取舍），**不是任务**，也不改变调度压力。',
    ph.ok
      ? `来源 ${ph.file} ｜ ${ph.chars} 字符 ｜ 逐字注入，未删减`
      : `⚠️ 正文未加载：${ph.file || '(未解析到路径)'} —— ${ph.why}。**如实报告，不代以摘要**（缺就是缺，不假装有）。`,
  ]
  if (!ph.ok) return head.join('\n')
  head.push(...refsWarning(a))
  return [...head, '', ph.text].join('\n')
}

export function philosophySkipLine(ph, prev, audit = null) {
  const a = audit === null ? refsAudit(ph) : audit
  return [
    '【外置哲学 · 已在本文任务线交付过 · 本次不重灌】',
    ...refsWarning(a),
    `sha=${ph.sha} ｜ ${ph.chars} 字符 ｜ 与上次交付一致（上次 ${prev?.at || '-'}`
      + `${prev?.count > 1 ? ` · 第 ${prev.count} 次交付` : ''}）`,
    '⇒ 正文已在本文历史里，**重启不等于换方法**：重复灌只会白白占窗口（真机实测这一项占 67%）。',
    '（若方法论真改了，sha 会变，这里会自动换回全文重灌 —— 不会静默吞掉。）',
  ].join('\n')
}

export function commitPhilosophyDelivery(st, ph, same) {
  if (!st || !ph || !ph.ok) return null
  const prev = st.philosophy_delivered || null
  const now = new Date().toISOString()
  if (same && prev && prev.sha === ph.sha) {
    st.philosophy_delivered = { ...prev, skipped: (prev.skipped || 0) + 1, seen_at: now }
  } else {
    st.philosophy_delivered = {
      sha: ph.sha, chars: ph.chars, file: ph.file, at: now, seen_at: now,
      count: (prev?.count || 0) + 1, skipped: prev?.skipped || 0,
    }
  }
  return st.philosophy_delivered
}

export function apply(ctx, config) {
  const cfg = { ...Config, ...(config || {}) }
  const workDir = cfg.workDir || process.cwd()
  const mark = { tools: 0, hooks: 0 }
  setWarnLogger((m) => ctx.logger?.warn?.(m))
  const fp = selfFingerprint()
  const state = cfg.stateFile ? resolve(cfg.stateFile) : join(workDir, 'outer-brain-state.json')
  const base = { fp, state, pid: process.pid, enabled: cfg.enabled !== false }
  const t0 = Date.now()
  try {
    applyInner(ctx, cfg, workDir, mark)
  } catch (error) {
    diag({ ...cfg, workDir }, mountLine({ ok: false, ...mark, ...base, ms: Date.now() - t0, error }))
    throw error
  }
  diag({ ...cfg, workDir }, mountLine({ ok: true, ...mark, ...base, ms: Date.now() - t0 }))
}

function applyInner(ctx, cfg, workDir, mark) {
  bindDiagRef({ ...cfg, workDir })

  let llmSvc = null
  let llmWhy = 'llm 服务未就绪'
  try {
    ctx.inject(['llm'], (c) => {
      llmSvc = c.llm
      llmWhy = ''
      return () => { if (llmSvc === c.llm) { llmSvc = null; llmWhy = 'llm 服务已卸载' } }
    })
  } catch (e) {
    llmWhy = `llm 服务注入失败：${String(e?.message || e).slice(0, 80)}`
  }

  let agentsSvc = null
  let agentsWhy = ''
  try {
    ctx.inject(['agents'], (c) => {
      agentsSvc = c.agents
      agentsWhy = ''
      return () => { if (agentsSvc === c.agents) agentsSvc = null }
    })
  } catch (e) {
    agentsWhy = `agents 注入失败：${String(e?.message || e).slice(0, 80)}`
  }

  const juryTarget = () => {
    const jc = cfg.jury || {}
    if (jc.provider && jc.model) return { provider: String(jc.provider), model: String(jc.model) }
    let a = lastAgent
    try { a = agentsSvc?.currentInitiator?.() || lastAgent } catch { }
    const o = a?.options || {}
    if (o.provider && o.model) return { provider: String(o.provider), model: String(o.model) }
    const h = a?.session?.requestHeader?.()?.config
    if (h?.provider && h?.model) return { provider: String(h.provider), model: String(h.model) }
    return null
  }

  const callJuror = async (target, req, timeoutMs, maxTokens) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    let text = ''
    let finish = null
    try {
      const stream = llmSvc.stream({
        provider: target.provider,
        model: target.model,
        system: req.system,
        messages: [{ role: 'user', content: [{ type: 'text', text: req.user }] }],
        temperature: 0,
        maxTokens,
        signal: ctrl.signal,
      })
      for await (const ch of stream) {
        if (ch?.type === 'text-delta') text += String(ch.text ?? '')
        else if (ch?.type === 'finish') { finish = ch.reason; break }
      }
    } finally { clearTimeout(timer) }
    const TRUNCATED = new Set(['length', 'max-tokens', 'max_tokens', 'maxOutputTokens'])
    if (finish && finish.kind) {
      if (TRUNCATED.has(String(finish.kind))) {
        try {
          diag({ ...cfg, workDir }, `jury-truncated kind=${finish.kind} chars=${text.length} maxTokens=${maxTokens}`)
        } catch { }
        throw new Error(`输出被 maxTokens 截断（finish=${finish.kind}，已收 ${text.length} 字）——调大 jury.maxTokens`)
      }
      if (finish.kind !== 'stop') {
        throw new Error(`模型未正常结束：${finish.kind}`
          + (finish.failure?.message ? `（${String(finish.failure.message).slice(0, 80)}）` : ''))
      }
    }
    return text
  }

  const runJury = async ({ claim, goal, done_when, facts, declared, history }) => {
    const jc = cfg.jury || {}
    const unavailable = (reason) => ({
      rec: J.juryRecord(J.tally([]), { why_unavailable: reason, provider: null, model: null }),
      tally: J.tally([]), target: null,
    })
    if (jc.enabled === false) return unavailable('配置里关掉了陪审（jury.enabled=false）')
    if (!llmSvc) return unavailable(llmWhy)
    const target = juryTarget()
    if (!target) {
      let a = lastAgent
      try { a = agentsSvc?.currentInitiator?.() || lastAgent } catch { }
      const o = a?.options || {}
      const h = a?.session?.requestHeader?.()?.config
      diag({ ...cfg, workDir },
        `jury-no-target cfg=${jc.provider || ''}/${jc.model || ''}`
        + ` agentsWhy=${agentsWhy || 'ok'}`
        + ` opts=${o.provider || ''}/${o.model || ''}`
        + ` hdr=${h?.provider || ''}/${h?.model || ''}`
        + ` agentKeys=${a ? Object.keys(a).join(',') : 'null'}`
        + ` optsKeys=${o ? Object.keys(o).join(',') : '-'}`)
      return unavailable('拿不到 provider/model（配置 jury.provider/model，或会话里发过请求；断点见诊断日志 jury-no-target）')
    }

    const mat = J.buildMaterials({ goal, claim, done_when, facts, declared, history })
    const timeoutMs = Number(jc.timeoutMs) > 0 ? Number(jc.timeoutMs) : 60000
    const maxTokens = Number(jc.maxTokens) > 0 ? Number(jc.maxTokens) : 2048
    const votes = await Promise.all(J.ROLES.map(async (role) => {
      try {
        const text = await callJuror(target, J.buildRequest(role, mat), timeoutMs, maxTokens)
        const v = J.parseVerdict(text)
        return { role: role.name, ...v, raw: String(text).slice(0, 400) }
      } catch (e) {
        return { role: role.name, verdict: J.VERDICT.undecidable,
          reason: `开庭异常：${String(e?.message || e).slice(0, 100)}`, missing: '', error: true }
      }
    }))
    const t = J.tally(votes)
    const rec = J.juryRecord(t, { provider: target.provider, model: target.model })
    diag({ ...cfg, workDir }, `jury ${t.decision} ${t.support}/${t.n} sup=${t.support} ins=${t.insufficient} und=${t.undecidable}`)
    return { rec, tally: t, target }
  }

  const runTerminationJury = async (decl) => {
    const unavailable = (reason) => ({
      rec: J.juryRecord(J.tally([]), { why_unavailable: reason, provider: null, model: null }),
      target: null,
    })
    const jc = cfg.jury || {}
    if (jc.enabled === false) return unavailable('配置里关掉了陪审（jury.enabled=false）')
    if (!llmSvc) return unavailable(llmWhy)
    const target = juryTarget()
    if (!target) return unavailable('拿不到 provider/model（断点见诊断日志 jury-no-target）')
    const pl = st.plan || P.newPlan()
    const ms = Object.values(pl.milestones || {})
    const msLine = ms.length
      ? ms.map((m) => `${m.id}[${m.status}]${m.blocked_on ? `⛔被外部条件挡住(${String(m.blocked_on).slice(0, 30)})` : ''}${String(m.text || '').slice(0, 40)}`).join('；')
      : '（无里程碑）'
    const obS = OB.summarizeOb(st.ob)
    const cn = st.contra || {}
    const mat = [
      '【要证明的那句话（claim）】',
      '这件事现在可以终止了（「向」已走到它的去向：达成 / 不可达 / 转移）。',
      '',
      '【向（用户的一句话界定；机制不替你判向）】',
      String(st.tree?.root || '（没设根锚）'),
      '',
      '【当事人声明的去向（未核实，仅当参考，不作为证据）】',
      JSON.stringify(decl),
      '',
      '【硬事实 · 交付账】',
      msLine,
      '',
      '【硬事实 · 矛盾账】',
      `节点 ${(cn.nodes || []).length} 条；根 ${cn.root ? cn.root.id : '（无）'}`,
      '',
      '【硬事实 · 义务账（四数并排）】',
      OB.obLine(st.ob) || `欠 ${obS.open} / 还 ${obS.settled} / 承接 ${obS.absorbed} / 销 ${obS.void}`,
      '',
      '判：当事人说「向已达成 / 不可达 / 转移」，上面的硬事实（尤其交付账里程碑状态）支持它吗？',
      '支持 ⇒ support；交付账还有未完成、且看不出「不可达」⇒ insufficient（还欠着，不该终止）。',
      '里程碑里标「⛔被外部条件挡住」的，是"本地够不到、缺的是外部才有的"——当事人声明「不可达」且 missing 正好对得上它，',
      '⇒ 这条不算"还欠着该继续"，算"证据到顶、接不可达"，判 support。',
      '「转移」（向变了）的真伪不由你判——向只来自用户；你只判「盘上有没有证据支持它声称的新向」。',
    ].join('\n')
    const timeoutMs = Number(jc.timeoutMs) > 0 ? Number(jc.timeoutMs) : 60000
    const maxTokens = Number(jc.maxTokens) > 0 ? Number(jc.maxTokens) : 2048
    const votes = await Promise.all(J.ROLES.map(async (role) => {
      try {
        const text = await callJuror(target, J.buildRequest(role, mat), timeoutMs, maxTokens)
        const v = J.parseVerdict(text)
        return { role: role.name, ...v, raw: String(text).slice(0, 400) }
      } catch (e) {
        return { role: role.name, verdict: J.VERDICT.undecidable,
          reason: `开庭异常：${String(e?.message || e).slice(0, 100)}`, missing: '', error: true }
      }
    }))
    const t = J.tally(votes)
    const rec = J.juryRecord(t, { provider: target.provider, model: target.model })
    diag({ ...cfg, workDir }, `termination-jury ${t.decision} ${t.support}/${t.n} sup=${t.support} ins=${t.insufficient} und=${t.undecidable}`)
    return { rec, target }
  }

  const statePool = new Map()
  let activeScope = null
  let activeCwdSlug = null
  let st = null
  let lastAgent = null

  const engaged = new Set()
  const silentSeen = new Set()
  const engHintSeen = new Set()
  const inherited = new Set()
  const gateMissSeen = new Set()
  const compactedAfter = new Set()
  let pendingLoad = null
  const engageKey = (a) => {
    const id = a && (a.session?.id ?? a.id ?? a.sessionId)
    return (typeof id === 'string' && id) ? id : null
  }
  const parentOf = new Map()
  const childSeen = new Set()
  const restoreTried = new Set()

  const isChildSession = (a) => {
    const h = a && a.session && a.session.header
    if (!h) return false
    if (h.origin === 'subagent') return true
    return typeof h.parentSession === 'string' && !!h.parentSession
  }

  const ownerSid = (a) => {
    const id = engageKey(a)
    if (!id) return null
    const p = a && a.session && a.session.header && a.session.header.parentSession
    if (typeof p === 'string' && p && p !== id) parentOf.set(id, p)
    let cur = id
    for (let n = 0; n < 8; n += 1) {
      const up = parentOf.get(cur)
      if (!up || up === cur) break
      cur = up
    }
    return cur
  }

  const resumeDirective = (plan, tasks) => {
    try {
      const dAll = P.deliveryAll(plan, tasks)
      const openTids = Object.keys(dAll).filter((k) => dAll[k].hasPlan && dAll[k].pending > 0)
      if (!openTids.length) return ''
      const names = openTids.map((k) => {
        const ids = dAll[k].pendingIds.map((id) => {
          const m = plan?.milestones?.[id]
          return id + (m?.text ? `（${String(m.text).slice(0, 24)}）` : '')
        }).join('、')
        return `${k} 还差 ${dAll[k].pending} 件：${ids}`
      }).join('；')
      return `【续接 · 上次没做完】${names} —— 继续做完。`
        + '出口三选一：① 继续做完；② brain_plan 处置 dropped/failed + why；③ 声明不可达并指名缺哪个外部条件。'
    } catch { return '' }
  }

  const ENGAGE_ON = /开机制|启用外置大脑|外置大脑上线|机制上线|机制上场|开脑/
  const ENGAGE_OFF = /关机制|停用外置大脑|外置大脑退场|外置大脑下线|机制退场|机制下线|不用机制|别管我|关脑/
  const INHERIT_ON = /接续|接着上次|继承上个|接上一条|接着上一条|继承上一条|续上一条|接手上一条/

  function engageIntent(txt) {
    if (!txt) return null
    const all = String(txt)
    const atSentenceStart = (re) => new RegExp('(^|[。！？!?\\n])\\s*(?:' + re.source + ')').test(all)
    const hasOff = atSentenceStart(ENGAGE_OFF)
    const hasInherit = atSentenceStart(INHERIT_ON)
    const hasOn = atSentenceStart(ENGAGE_ON)
    if (!hasOff && !hasInherit && !hasOn) return null
    if (hasOff) return 'off'
    if (hasInherit) return 'inherit'
    if (hasOn) return 'on'
    return null
  }

  const currentAgent = () => {
    try {
      const a = agentsSvc?.currentInitiator?.()
      if (a) { lastAgent = a; return a }
    } catch { }
    return lastAgent
  }

  const scoped = () => ({ ...cfg, workDir, scope: activeScope })

  function bindSession(agent) {
    const cwd = agent?.session?.header?.cwd
    const rawSid = agent?.session?.id ?? agent?.id ?? null
    const sid = rawSid ? (ownerSid(agent) ?? rawSid) : null
    const cwdSlugV = cwd ? scopeSlug(cwd) : '_nocwd'
    const sidSlugV = sid ? sidSlug(sid) : null
    const key = sidSlugV ? `${cwdSlugV}/sessions/${sidSlugV}` : (cwd ? cwdSlugV : null)
    if (!key) return null
    activeCwdSlug = cwdSlugV
    if (key === activeScope) return st
    if (activeScope && st) saveState({ ...cfg, workDir, scope: activeScope }, st)
    activeScope = key
    if (!statePool.has(key)) {
      const fresh = loadState({ ...cfg, workDir, scope: key })
      if (!fresh.tree) fresh.tree = T.newTree()
      T.ensureMeta(fresh.tree)
      statePool.set(key, fresh)
      ctx.logger?.info(`${name}: 载入任务线 scope=${key} 池中 ${Object.keys(fresh.pool.entries).length} 条`)
      const sp = statePaths({ ...cfg, workDir, scope: key })
      const has = !!(sp.file && existsSync(sp.file))
      let mt = '-'
      try {
        if (has) mt = new Date(statSync(sp.file).mtimeMs).toISOString().slice(0, 19).replace('T', ' ')
      } catch { }
      const np = Object.keys(fresh.pool.entries).length
      const nt = Object.keys((fresh.graph || {}).tasks || {}).length
      const nd = Object.keys((fresh.graph || {}).debt || {}).length
      const nq = Object.keys((fresh.tree || {}).questions || {}).length
      const ph = readPhilosophy(cfg)
      const prevPh = fresh.philosophy_delivered || null
      const phSame = !!(ph.ok && prevPh && prevPh.sha && prevPh.sha === ph.sha)
      const rd = resumeDirective(fresh.plan, fresh.tree?.tasks)
      const resumeLine = rd ? '\n' + rd : ''
      const docIndex = (() => {
        const rows = [
          ['METHODS.md', '七手法与断点表（卡住时查这张）'],
          ['DERIVATION.md', '判据的推导链（学"怎么推"，不是抄结论）'],
          ['ASSUMPTIONS.md', '我选的预设与影响级别（错了会怎样）'],
          ['AUDIT.md', '概念 → 字段 → 读取点 的体检表'],
        ]
        const ok2 = []
        for (const [n, what] of rows) {
          try {
            if (fs.statSync(resolve(here, '..', n)).size > 0) ok2.push(`${n}（${what}）`)
          } catch { }
        }
        return ok2.length ? `\n📚 机制自身的维护台账（**不是你手上任务的待办** —— 只有任务真的涉及"改机制"时才看；里面写"要重启才生效"指的是插件改动，与你正在做的业务无关）：${ok2.join('；')}` : ''
      })()
      pendingLoad = {
        scope: key,
        line: `【外置大脑 · 已加载】硬盘→内存：scope=${key}`
          + ` ｜ 池 ${np} 条 ｜ 树种 ${nq} 问 / ${nt} 任务 ｜ 账 ${nd} 件`
          + ` ｜ 来源 ${has ? sp.file : '（盘上尚无这条线 ⇒ 全新）'}${has && mt !== '-' ? `（mtime ${mt}）` : ''}`
          + docIndex
          + resumeLine,
        philosophy: ph,
        phSame,
        phPrev: prevPh,
      }
      diag({ ...cfg, workDir },
        `load scope=${key} pool=${np} tasks=${nt} debt=${nd} questions=${nq}`
        + ` from=${has ? sp.file : '(新线，盘上无文件)'} mtime=${mt}`)
      diag({ ...cfg, workDir },
        `philosophy ${ph.ok ? 'OK' : 'MISS'} chars=${ph.chars} sha=${ph.sha || '-'} same_as_delivered=${phSame ? 1 : 0}`
        + ' refs=pending(校验在注入时做)'
        + ` from=${ph.file || '-'}` + (ph.ok ? '' : ` why=${ph.why}`))
    }
    st = statePool.get(key)
    diag({ ...cfg, workDir },
      `bind scope=${key} kind=${sidSlugV ? 'session' : 'cwd-fallback'} sid=${sid || '-'} cwd=${cwd || '-'}`)
    return st
  }

  function persistEngage(agent, on) {
    try {
      if (!bindSession(agent) || !st) return
      st.engage = { on: !!on, at: new Date().toISOString() }
      const r = saveState(scoped(), st)
      diag({ ...cfg, workDir },
        `engage PERSIST on=${!!on} scope=${activeScope} file=${typeof r === 'string' ? r : '-'}`)
    } catch (error) {
      diag({ ...cfg, workDir }, `engage PERSIST-FAIL ${String(error)}`)
    }
  }

  function readEngageFlag(agent) {
    try {
      const cwd = agent?.session?.header?.cwd
      const sid = ownerSid(agent)
      if (!sid) return null
      const key = `${cwd ? scopeSlug(cwd) : '_nocwd'}/sessions/${sidSlug(sid)}`
      const sp = statePaths({ ...cfg, workDir, scope: key })
      if (!sp.file || !existsSync(sp.file)) return null
      const raw = JSON.parse(readFileSync(sp.file, 'utf8'))
      return raw && raw.engage && raw.engage.on === true ? raw.engage : null
    } catch { return null }
  }

  function inheritLatest() {
    const cands = listLineStates({ ...cfg, workDir }, activeCwdSlug || '_nocwd')
    if (!cands.length) return null
    const curFile = resolve(join(workDir, 'projects', activeScope || '', 'outer-brain-state.json'))
    const pick = cands.find((c) => resolve(c.file) !== curFile)
    if (!pick) return { empty: true }
    let raw = null
    try { raw = JSON.parse(readFileSync(pick.file, 'utf8')) } catch { return null }
    const merged = normalizeState(raw)
    delete merged.stall_streak
    T.ensureMeta(merged.tree)
    statePool.set(activeScope, merged)
    st = merged
    return {
      from: pick.file,
      pool: Object.keys(merged.pool.entries).length,
      tasks: Object.keys(merged.graph.tasks || {}).length,
    }
  }

  const tickPool = new Map()
  const tick = () => {
    const k = activeScope || '_'
    if (!tickPool.has(k)) tickPool.set(k, { ticks: 0, last: null })
    return tickPool.get(k)
  }
  let stallStreak = -1

  ctx.logger?.info(
    `${name}: 加载（enabled=${cfg.enabled} guide=${cfg.guide} ledger=${cfg.ledger} `
    + `CAP=${cfg.cap} 状态按项目分片 —— 池在首次进入会话时载入）`,
  )

  if (!cfg.enabled) {
    ctx.logger?.warn(`${name}: enabled=false ⇒ 不注册工具、不注入`)
    return
  }

  const _register = (...a) => ctx.tools.register(...a)
  const reg_disabled = () => {}
  const TOOL_COST = Object.freeze({
    brain_verify: 5, brain_plan: 2, brain_contra: 2, brain_observe: 1, brain_settle: 1,
  })

  const reg = (def) => {
    const orig = def.execute
    _register({
      ...def,
      async execute(...a) {
        const cur = currentAgent()
        const gk = ownerSid(cur)
        if (!engaged.has(gk)) {
          const tag = gk || '(取不到会话身份)'
          if (!gateMissSeen.has(tag)) {
            gateMissSeen.add(tag)
            diag({ ...cfg, workDir },
              `gate MISS tool=${def.name} key=${tag} engaged=${engaged.size} 条 —— 工具侧判未启用`
              + (gk ? '' : '（currentInitiator 与 lastAgent 都没给出 agent ⇒ 闸键取不到）'))
          }
          return {
            enabled: false,
            note: '外置大脑在本会话未启用（默认静默）—— 本条不执行任何记账。'
              + '启用：说「开机制」；退场：说「关机制」。',
          }
        }
        if (!bindSession(cur)) {
          return { error: '无会话作用域：取不到 agent.session.header.cwd ⇒ 拒绝读写状态（防跨项目污染）' }
        }
        if (String(def.name || '').startsWith('brain_')) {
          tick().ticks += 1
          diag({ ...cfg, workDir }, `tool ${def.name}`)
          const cost = TOOL_COST[def.name] || 0
          if (cost > 0) {
            const total = Number(st.tree?.budget || 100)
            st.tree.spent = Math.min(total, Number(st.tree.spent || 0) + cost)
          }
        }
        return orig.apply(def, a)
      },
    })
    mark.tools += 1
    if (def && def.name) REGISTERED_TOOLS.add(String(def.name))
  }

  reg({
    name: 'brain_status',
    description:
      '外置大脑·看状态：返回证据池水位（每条：现值/峰值/档位/观测数/挑战数）、'
      + '当前全部报警（**欠账口径**：至今未复核的反证），以及六种常规做法与升维定义的速查。'
      + '在动手前、或在纠结"是不是该改方向"时调它。',
    parameters: { type: 'object', properties: {}, additionalProperties: true },
    output: jsonOutput(OPEN_OBJ),
    async execute() {
      try {
        return await statusBody()
      } catch (e) {
        diag({ ...cfg, workDir }, `status CRASH plan=${P.PLAN_VERSION} :: ${String(e && e.message).slice(0, 160)}`)
        diag({ ...cfg, workDir }, `status STACK ${String(e && e.stack || '').split('\n').slice(0, 6).join(' || ').slice(0, 900)}`)
        return {
          ok: false,
          error: 'brain_status 崩了：' + String(e && e.message),
          plan_version: P.PLAN_VERSION,
          hint: '栈已写进 .outer-brain-diag.log 的 status STACK 行；`brain_plan action:"list"` 可临时替代看账。',
        }
      }
    },
    presentCall: () => ({ card: 'generic', title: '外置大脑·状态', kind: 'other', rawInput: {} }),
  })

  async function statusBody() {
      const jh = await probeJevHealth(st, cfg)

      const recentWrites = (() => {
        const mins = Number(cfg?.recentWriteMins || 10)
        const cut = Date.now() - mins * 60000
        const out = []
        try {
          const dir = resolve(workDir)
          for (const sub of ['dsh', '.']) {
            const d = sub === '.' ? dir : resolve(dir, sub)
            if (!existsSync(d)) continue
            for (const f of readdirSync(d)) {
              if (!/\.(mjs|js|json|md)$/.test(f)) continue
              const fp = resolve(d, f)
              try {
                const st2 = statSync(fp)
                if (st2.isFile() && st2.mtimeMs > cut) {
                  out.push({ file: sub === '.' ? f : sub + '/' + f, minsAgo: Math.round((Date.now() - st2.mtimeMs) / 60000) })
                }
              } catch {}
            }
          }
        } catch {}
        return out.sort((a, b) => a.minsAgo - b.minsAgo).slice(0, 12)
      })()

      return {
        report: renderReport(st, { ...cfg, workDir }),
        brief: renderBrief(st, { ...cfg, workDir }),
        jev_health: jh.status,
        ...(recentWrites.length ? { concurrent_writers: { note: '这些文件最近被改过（可能是别的 agent、也可能是你）—— 动手写之前先确认没人在改', files: recentWrites } } : {}),
        ...(jh.fix ? { jev_fix: jh.fix } : {}),
        ...(() => {
          try {
            const tk = FLOW.tick(st, { budget: { budgetUsed: 0, budgetTotal: Number(st.tree?.budget || 100) } })
            return {
              flow: {
                loop: tk.loop,
                ring: tk.ring,
                main: tk.main ? { id: tk.main.id, strength: Number(tk.main.strength.toFixed(2)), why: tk.main.why } : null,
                terrain: { fish: tk.terrain.fish.level, sand: tk.terrain.sand.action, bottle: tk.terrain.bottle.split ? tk.terrain.bottle.pieces : false, lines: tk.terrain.lines.hits.map((h) => h.line) },
                unknown: tk.unknown,
                outerActions: tk.outerActions || [],
                verdict: tk.agg ? tk.agg.verdict : null,
                next: tk.agg ? tk.agg.line : null,
                muted: tk.agg ? tk.agg.muted.map((m) => m.kind) : [],
                brief: tk.brief,
              },
            }
          } catch (e) {
            return { flow: { error: String(e.message || e).slice(0, 80) } }
          }
        })(),
        counts: {
          entries: Object.keys(st.pool.entries).length,
          rounds: (st.pool.rounds || []).length,
          tasks: Object.keys(st.graph.tasks).length,
          debt: Object.keys(st.graph.debt || {}).length,
          beliefs: Object.keys(st.beliefs || {}).length,
          hazards_open: Object.values(st.hazards?.items || {}).filter((h) => h.status === 'open').length,
          contra_nodes: Object.keys(st.contra?.nodes || {}).length,
          mode: cfg && cfg.lean === true ? 'lean' : 'full',
          turn_sec: st.turn_sec ?? null,
          stuck: P.stuckMilestones(st.plan),
          jury: P.juryStats(st.plan),
          task_origin: Object.values(st.tree?.tasks || {}).reduce((a, t) => {
            const k = t.origin || 'undefined'
            a[k] = (a[k] || 0) + 1
            return a
          }, {}),
        },
        obligation: { retired: true, note: '义务账已退役（2026-10-19）：零入口且与四处状态重复，见 INSTITUTIONS B11' },
        contra: CN.contraSummary(st.contra),
        matrix: {
          L1_window: (st.matrix || {}).L1?.length ?? 0,
          L2_pending: (st.matrix || {}).L2?.length ?? 0,
          L3: (st.matrix || {}).L3 ?? null,
          lights: M.matrixLights(st.matrix || M.newMatrix(), st.pool, null),
          anchors: Object.values(st.cards || {}).reduce((a, c) => {
            a.total += 1; if (c.root !== null && c.layer !== null) a.anchored += 1; return a
          }, { total: 0, anchored: 0 }),
        },
      }
  }

  reg({
    name: 'brain_observe',
    description:
      '外置大脑·记证据：往池子里加水。**必须先过滤网** —— '
      + '①判断类不是证据（evidenceClass=judg 会被降级为信号，不动水位）；'
      + '②归属必须互斥（同一事实不能被引作两边，否则记一次伪矛盾信号并拒收）；'
      + '③必须有量级（给 lr 或 evidencePp；pp 低于噪声地板 20pp 会被拒收）。'
      + '每次都要写 why（**这条证据是什么**），它是事后唯一能复查的东西。'
      + 'rid 是条目编号；新条目会被自动创建（先验默认"中"）。',
    parameters: {
      type: 'object',
      properties: {
        rid: { type: 'string', description: '条目编号，如 A3 / B1' },
        qid: { type: 'string', description: '★这条证据属于树上哪个节点（任务 T1 / 子问题 Q2）。'
          + '它决定这条的权重（从该节点的额度继承），也决定「本轮注意力落在哪」。不给 ⇒ 散卡，排序恒排最后' },
        claim: { type: 'string', description: '★这条信念到底是一句什么话（可判真伪）。一次证据只能服务一句话' },
        prior: { type: 'number', description: '★先验 p∈(0,1)：**在看到证据之前**的把握。不许写"高/中/低"' },
        expect: { type: 'string', description: '★预期：如果这句话为真，我应该看到什么（可判定的断言，如 "0 failed" / 文件名 / 数值）' },
        observed: { type: 'string', description: '★观测：实际看到了什么。与 expect 不符 ⇒ 机制自动扣分（LR=(1-p1)/(1-p0)）' },
        tol: { type: 'number', description: '数值型预期的容差（expect/observed 都是数字时生效）' },
        receipt: { type: 'string', description: '★★回执：怎么验的、在哪能看到（命令原文 / 路径 / URL / 输出摘要）。**空 ⇒ 本条权重 0，水位不动**——这是治"编造证据"的唯一闸' },
        receiptGrade: { type: 'string', enum: ['verified', 'artifact'], description: 'verified=命令可复跑且有退出码（权重1.0）/ artifact=路径·URL·引文（0.6）' },
        pE_if_true: { type: 'number', description: '★p(看到「这个具体观测」| claim 为真)。LR=p1/p0 是信念唯一的方向来源。'
          + '必须随观测值变（别写死一组数）：观测符合预期 ⇒ p1>p0；不符合 ⇒ p1<p0。'
          + '与 expect/observed 的方向相反 ⇒ 判"填反"，整条拒收' },
        pE_if_false: { type: 'number', description: '★p(看到「这个具体观测」| claim 为假)。两者接近 ⇒ LR≈1 ⇒ 这条证据无信息量，会被拒收' },
        answers: { type: 'string', description: '回答必答单里的哪一条（填问题 id 如 Q1；回答后该问题才算交账）' },
        assumptions: { type: 'array', items: { type: 'string' }, description: '★★这次「取」引入了哪些假设/边界。判死时要**交回这些假设**（不是只改结论）——这就是"取错了重新取"' },
        direction: { type: 'string', enum: ['support', 'challenge'], description: '【**旧通道 · 降级路径**】支持还是挑战。'
          + '⚠️ 走这条**不产生 p**（`strength` 已降级为自述、不计入校准）⇒ 只记下"有这么一条"，池子水位不动。'
          + '只在**实在给不出 receipt** 时用它；有回执就走新通道（claim/prior/expect/observed/receipt/pE_*）。' },
        strength: { type: 'number', description: '【旧通道】已降级为自述 —— **不计入校准**。新提交请改用 pE_if_true/pE_if_false' },
        why: { type: 'string', description: '这条证据是什么（必填，不许写空话）' },
        lr: { type: 'number', description: '似然比（旧通道；<2.33 拒收）' },
        evidencePp: { type: 'number', description: '量级（旧通道，百分点）；|pp|<20 拒收' },
        evidenceClass: { type: 'string', enum: ['obs', 'judg', 'precedent'],
          description: 'obs=观测类（真证据）/ judg=判断类（降级为信号，不进账）/ '
            + '**precedent=先例类**（别人已验证的做法：文档/仓库/厂商实现）。'
            + '先例类必须同时给 source_ref + expect（转写成本项目判据）+ observed（实测），'
            + '且**与先例不一致的反而权重更高**（借鉴的价值在差异，不在"我也一样"）' },
        source_ref: { type: 'string', description: '★先例类的来源（文档名+版本 / 仓库+commit / 厂商名）。'
          + '指名到可查 —— 写"网上说""业界普遍"不收' },
        exclusive: { type: 'boolean', description: '归属是否互斥（false ⇒ 记伪矛盾并拒收）' },
        root: { type: 'string', description: '★锚：这条需求服务哪个根本问题（填主需求的 rid）。缺它 ⇒ 卡进不了排序矩阵（原设计 core.mjs:724「缺了它，矩阵是一叠散卡」）' },
        layer: { type: 'string', description: '★锚：这条在哪一层（L1 步/轮 · L2 段/批 · L3 项目）' },
        weight: { type: 'number', description: '⚠️已废（2026-10-17）：自报权重不再影响排序，只留档。'
          + '权重来自树 —— 用 qid 指认这条属于哪个节点，由那个节点的额度决定。'
          + '**边界（2026-10-18）**：qid 推不出归属时（无锚 / 树侧 rids 为空）权重回落**均分**，'
          + '并在 diag 记 `weight_fallback`，否则静默 0 就是假绿。'
          + '反证：这条「只能来自树」在真机上 12/12 全 0 —— 它从来没生效过，也没人知道。' },
      },
      required: ['rid', 'direction', 'strength', 'why'],
      additionalProperties: true,
    },
    output: jsonOutput(OPEN_OBJ),
    async execute(args) {
      const r = observeRound(st, args)
      const { accepted: ok, message: msg, rid, e, belief } = r
      const saved = saveState(scoped(), st)
      diag({ ...cfg, workDir }, `observe ${rid} ${args.direction} ok=${ok}`
        + (belief ? ` p=${belief.p.toFixed(3)} contra=${belief.n_contra}${belief.would_contract ? ' ★回到空候选' : ''}` : ' 自述通道'))
      return {
        accepted: ok, message: msg, rid,
        n: e.n, confEvidence: C.confOf(e.n),
        confNow: C.confNow(e, cfg.ledger, cfg.decay), band: C.bandOf(C.confNow(e, cfg.ledger, cfg.decay)),
        belief: belief || null,
        ...(r.回到空 ? { 回到空: r.回到空 } : {}),
        note: ok ? '已进水。想让"本轮"生效，轮末调 brain_settle。' : '被滤网挡下（**没进水**）—— 这是设计，不是故障。',
        saved,
      }
    },
    presentCall: () => ({ card: 'generic', title: '外置大脑·记证据', kind: 'other', rawInput: {} }),
  })

  reg({
    name: 'brain_settle',
    description:
      '外置大脑·轮末结算：把本轮的水位算进历史、累加"零新证据"的轮数。'
      + '每完成一批工作调一次（它让"时效折价"与"停滞判据"生效）。',
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: '本轮标签，如 R7' },
        reviews: {
          type: 'array',
          description: '★复核完成事件（**唯一的清零入口**）：每条须带 rid + verdict + why，缺一不算完成。'
            + '「指派复核」不清账，「完成复核」才清账（旧实现把两者混为一谈 ⇒ 报警被自消费）。',
          items: {
            type: 'object',
            properties: {
              rid: { type: 'string' }, verdict: { type: 'string', description: 'still_low / raised / killed / 其它' },
              why: { type: 'string', description: '凭什么这么判（必填）' },
            },
            required: ['rid', 'verdict', 'why'], additionalProperties: true,
          },
        },
        hazards: {
          type: 'array',
          description: '★结隐患（转移走的矛盾）。每条三选一：'
            + 'fire（复发 ⇒ 证明当初那一步取错了 ⇒ 交回那次「取」的假设，回到空重取）；'
            + 'accept（显式接受 ⇒ **必须写 cost**，否则是装作不存在）；'
            + 'still（本轮查了、未复发 ⇒ 记录在案，不结账）。',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '隐患编号 H-n' },
              action: { type: 'string', enum: ['fire', 'accept', 'still'] },
              why: { type: 'string', description: '凭什么判复发/未复发（必填）' },
              cost: { type: 'string', description: 'accept 时必填：接受这个隐患的代价是什么' },
              until: { type: 'string', description: 'accept 的期限（到期必须重判）' },
            },
            required: ['id', 'action', 'why'], additionalProperties: true,
          },
        },
        unknown: {
          type: 'array',
          description: '★这一轮看到的"契约外"的东西（跑出来但规格里没写 / 计划偏离 / 你或用户的直觉）。'
            + '每条 {source, raw}：source 四选一 off-contract（契约外输出）/ deviation（计划偏离）/ human（人的直觉）/ observed（观察到的外部事实）。'
            + '⚠️ 入池后是 **raw**，要先分类再吸收（raw 直接 absorbed 会被拒）。',
          items: {
            type: 'object',
            properties: {
              source: { type: 'string', enum: ['off-contract', 'deviation', 'human', 'observed'] },
              raw: { type: 'string', description: '原话/原样，别改写（改写了就不是观察了）' },
              from: { type: 'string', description: '哪来的（可选）' },
            },
            required: ['source', 'raw'], additionalProperties: true,
          },
        },
      },
      required: ['label'], additionalProperties: true,
    },
    output: jsonOutput(OPEN_OBJ),
    async execute(args) {
      settleRound(st, String(args.label), args.reviews || [])

      const uOut = []
      if (!st.unknown) st.unknown = UNK.newPool()
      for (const u of args.unknown || []) {
        try {
          const id = UNK.capture(st.unknown, { source: u.source, raw: u.raw, from: u.from || '' })
          uOut.push(`📥 ${id} 已入未知池（${u.source}）`)
        } catch (e) { uOut.push(`❌ 捕获失败：${String(e.message || e).slice(0, 60)}`) }
      }
      const hazardOut = []
      if (!st.hazards) st.hazards = BL.newHazardStore()
      for (const h of args.hazards || []) {
        const id = String(h.id || '')
        if (h.action === 'fire') {
          const r = BL.fireHazard(st.hazards, id, { evidence: String(h.why || '') })
          if (!r.ok) { hazardOut.push(`❌ ${id}: ${r.reason}`); continue }
          const card = r.from ? st.cards?.[r.from] : null
          if (card) C.backToEmpty(card, `隐患 ${id} 复发 ⇒ 那次「取」判错，回到空重取：${h.why}`)
          hazardOut.push(`🔥 ${id} 复发 ⇒ 交回假设「${r.retract_assumption || '（未记假设）'}」`
            + `${card ? '，卡已打回「已回到空」' : ''}`)
          if (r.from && st.contra?.nodes?.[r.from]) {
            const rv = CN.revive(st.contra, r.from, { why: `隐患 ${id} 复发：${h.why || ''}` })
            if (rv.ok) hazardOut.push(`↩ ${rv.why}`)
          }
        } else if (h.action === 'accept') {
          const r = BL.acceptHazard(st.hazards, id, { by: 'agent', cost: String(h.cost || ''), until: h.until })
          hazardOut.push(r.ok ? `📌 ${id} 转为接受的欠账（代价：${h.cost}）` : `❌ ${id}: ${r.reason}`)
        } else {
          const seen = String(h.why || '')
          const points = /账上|B-\d|H-\d|预言|新墙/.test(seen)
          if (!st.ledgerGate) st.ledgerGate = { streak: 0 }
          if (!points) {
            st.ledgerGate.streak += 1
            st.ledgerGate.last_at = new Date().toISOString()
            st.ledgerGate.last_why = `（未读账）${seen.slice(0, 160)}`
            hazardOut.push(`❌ ${id}: 只写「${seen.slice(0, 20) || '（空）'}」不算读账。`
              + '要说出**账上哪一条预言了这次撞的墙**（引用它的 id 或 fire_when），'
              + '或者说清这是**新墙**并登记。判据：含「账上 / B-n / H-n / 预言 / 新墙」之一。'
              + `｜当前欠读连续 ${st.ledgerGate.streak} 轮`)
            continue
          }
          st.ledgerGate.streak = 0
          st.ledgerGate.last_at = new Date().toISOString()
          st.ledgerGate.last_why = seen.slice(0, 200)
          const it = st.hazards.items[id]
          if (it) { it.last_checked = new Date().toISOString(); it.last_why = seen }
          hazardOut.push(`👀 ${id} 读账通过：${seen.slice(0, 60)}`)
        }
      }
      let axOut = null
      try {
        const ms = Object.values(st.plan?.milestones || {})
        const first = ms[0] || {}
        const openContra = Object.values(st.contra?.nodes || {}).filter((x) => x && x.status !== 'solved' && x.status !== 'redefined')
        const lastEvAll = Object.values(st.plan?.milestones || {})
          .flatMap((mm) => (mm.evidence || []).slice(-1))
        const lastEv = lastEvAll[lastEvAll.length - 1] || {}
        const changedCount = Array.isArray(lastEv.changed) ? lastEv.changed.length : 0
        const capturedNew = Object.keys(st.unknown?.items || {}).length
        const acted = lastEvAll.length > 0
        const terms = Array.isArray(st.termination) ? st.termination : []
        const hasTerm = terms.length > 0
        const humanConfirmed = hasTerm && terms.some((t) => t && (t.by === 'human' || t.human === true))
        const hasElse = Boolean(
          (first.if_wrong && String(first.if_wrong).trim())
          || (first.dropped_why && String(first.dropped_why).trim())
          || (first.blocked_on && String(first.blocked_on).trim()),
        )

        axOut = AXA.audit({
          hasModel: Object.keys(st.tree?.tasks || {}).length > 0,
          define: first.define,
          doneWhen: first.done_when,
          conflicts: Object.values(st.tree?.tasks || {}).reduce((a2, t) => a2 + ((t && t.conflicts) || []).length, 0),
          openContra: openContra.length,
          contraWithDecision: openContra.filter((x) => String(x.decision || '').trim()).length,
          changedCount,
          capturedNew,
          acted,
          needsHumanGate: hasTerm,
          humanConfirmed,
          hasFlow: true,
    elsePath: hasElse ? 'ok' : null,
        })
      } catch (e) {
        axOut = { ok: true, brief: `· 十公理自检跑不起来（${String(e.message || e).slice(0, 50)}）`, red: [], grey: [] }
      }
      const saved = saveState(scoped(), st)
      const uState = UNK.waterline(st.unknown, cfg || {})
      return {
        ...(uOut.length ? { unknown_captured: uOut } : {}),
        unknown_pool: { open: uState.open, limit: uState.limit, over: uState.over, brief: UNK.brief(st.unknown, cfg || {}) },
        ...(st.tree?.tuning?.due ? { tune_due: st.tree.tuning.due } : {}),
        axioms: axOut ? { ok: axOut.ok, red: axOut.red.map((x) => x.id), grey: axOut.grey.map((x) => x.id), brief: axOut.brief } : null,
        settled: String(args.label), rounds: st.pool.rounds,
        reviews: st.pool._last_reviews || [],
        hazards: hazardOut,
        hazardSummary: BL.hazardSummary(st.hazards),
        saved,
      }
    },
    presentCall: () => ({ card: 'generic', title: '外置大脑·结算', kind: 'other', rawInput: {} }),
  })

  reg_disabled({
    name: 'brain_enforce',
    description:
      '外置大脑·跑一轮：把**当前报警**映射成**该做的动作**（补观测/复核/降维/升维/取舍/知止），'
      + '并写回状态（含债务表与"复核即清零"）。返回：六类分类分布、选了哪些动作、'
      + '**放弃了哪些**（取舍单三要素）、方向是否改变。'
      + '它只做「探测」不做「决策」—— 类别跨越仍须你自己走 Q0~Q3 给理由。',
    parameters: {
      type: 'object',
      properties: { label: { type: 'string', description: '轮次标签' } },
      required: ['label'], additionalProperties: true,
    },
    output: jsonOutput(OPEN_OBJ),
    async execute(args) {
      const label = String(args.label)
      const r = enforce(st, { ...cfg, workDir }, label)
      if (!st.cards) st.cards = {}
      for (const nid of (r.newNodes || [])) {
        const card = st.cards[nid] || C.newCard(nid, { kind: '派生问题' })
        C.dispatch(card, nid, 'agent')
        st.cards[nid] = card
      }
      const saved = saveState(scoped(), st)
      diag({ ...cfg, workDir }, `enforce ${label} ops=${r.ops.length} changes=${r.changes.length}`)
      matrixRow(st, r, cfg, label)
      if (!st.hazards) st.hazards = BL.newHazardStore()
      for (const op of r.ops) {
        if (!['SPLIT', 'RERUN', 'LIFT', 'EITHER'].includes(op.op)) continue
        const exists = Object.values(st.hazards.items)
          .some((h) => h.from === op.rid && h.status === 'open')
        if (exists) continue
        BL.openHazard(st.hazards, {
          from: op.rid,
          what: `${op.op}·${op.rid}：${String(op.detail || op.tag || '').slice(0, 60)}`,
          where: op.op === 'SPLIT' ? '拆到更细粒度（子问题层）'
            : op.op === 'LIFT' ? '换到更高抽象层'
              : '同层重判（再做一次）',
          fire_when: '同一报警再次出现，或该条目 p 跌破地板',
          due_round: null,
          assumption: `${op.op} 能解决 ${op.rid}`,
        })
      }
      st.matrix.L3.direction = r.after ?? null
      const lights = M.matrixLights(st.matrix, st.pool, label)
      const saved2 = saveState(scoped(), st)
      diag({ ...cfg, workDir }, `round ${matrixLine(st.matrix, st.pool, label)}`)
      return {
        round: label,
        classification: Object.fromEntries(Object.entries(r.cats).map(([k, v]) => [k, v[0]])),
        lambdaRaw: r.lambdaRaw, lambdaAction: r.lambdaAction, cap: cfg.cap,
        chosen: r.ops.map((o) => ({ op: o.op, rid: o.rid, k: o.k ?? 1, tag: o.tag })),
        dropped: r.dropped.map((d) => ({ op: d.op, rid: d.rid, cost: d.cost, reEvaluate: d.re_evaluation_condition })),
        changes: r.changes, newNodes: r.newNodes, reviewed: r.reviewed,
        directionChanged: r.moved,
        unknownPool: r.undetRids, repoolRequest: r.cats && C.repoolNeeded(r.undetRids.length, Object.keys(r.cats).length),
        note: '类别跨越（改判）必须走 Q0~Q3 并给理由 —— 机制只报警、不替你改判。',
        matrix: {
          L1_window: st.matrix.L1.length,
          L2_pending: st.matrix.L2.length,
          L3: st.matrix.L3,
          capRespected: r.ops.length <= cfg.cap,
          lights,
        },
        saved,
        saved2,
      }
    },
    presentCall: () => ({ card: 'generic', title: '外置大脑·跑一轮', kind: 'other', rawInput: {} }),
  })

  reg({
    name: 'brain_lift_check',
    description:
      '外置大脑·升维判据：判一条"升维方案"到底是**取**、**执**，还是**暂时升不了**。'
      + '⭐ 升维要成立，两件事都要交代清（2026-10-18 用户：「升维怎么升？去找哪个模型，去找哪个算法」）：'
      + '① **变量集合变**（claimVariables − oldVariables ≠ ∅）——只证"多了一项"，不证"换了层"；'
      + '② **用哪种手段、从谁那儿借的**（`way` + `source`）——这才是"怎么升"。可选四种：'
      + `ladder=${L.LIFT_WAY.ladder.name}（上一问为什么要它/下一问所以要什么）／`
      + `restate=${L.LIFT_WAY.restate.name}（把"X 不行"改成"X 在什么条件下才行"）／`
      + `separate=${L.LIFT_WAY.separate.name}（时间/空间/条件/整体部分分离）／`
      + `counter=${L.LIFT_WAY.counter.name}（构造让两条判据同时为真的例子）。`
      + '这些都不是我想的：ladder 借自 abstraction laddering、restate 借自 CPS 的问题重构、'
      + 'separate 借自 TRIZ 分离原理、counter 借自最小反例法 —— 有人走过的路，先去借，不必每次从空中取。'
      + '⭐ `source` 四种：precedent（已有先例，给名字/路径）／user（用户原话关键词）／'
      + 'evidence（盘上证据 rid）／search（这次真去外面查了，给查询词与查到了什么）。'
      + '说不出 source ⇒ 允许，但记为**从空中取**：账上留着，后面有证据撞到它时先怀疑这一条。'
      + '⭐ `blank:true` + why + revisit ⇒ **承认这次想不出怎么升**（未决，挂到期再回来），'
      + '不是执，也不是取 —— 没探索过的地方留空，是正当选项。'
      + '⚠️ 只写变量名、不说用哪招 ⇒ 按**执**判（旧 LIFT 判据就是被这条路绕过的）。',
    parameters: {
      type: 'object',
      properties: {
        claim: { type: 'string', description: '新层命题（一句话）' },
        claimVariables: { type: 'array', items: { type: 'string' }, description: '新层命题的变量集合' },
        oldVariables: { type: 'array', items: { type: 'string' }, description: '旧层变量集合' },
        kills: { type: 'string', description: '【条件②】点名哪条旧矛盾在新层下不成立了（id 或原文关键词，≥6 字）。说不出 ⇒ 这次是换说法，不是升维。' },
        new_contra: { type: 'string', description: '【条件③】新层自己产生的矛盾（≥10 字）。取即有边界，边界即矛盾；说不出 ⇒ 取没真发生。' },
        covers: {
          type: 'object',
          description: '【条件①】新层覆盖旧层的变量集（旧变量都要在；缺一个就说明换的是不相干的层）',
          properties: {
            oldVariables: { type: 'array', items: { type: 'string' } },
            claimVariables: { type: 'array', items: { type: 'string' } },
          },
          additionalProperties: false,
        },
        way: { type: 'string', enum: Object.keys(L.LIFT_WAY),
          description: `用了哪种手段：${L.wayMenu()}` },
        source: {
          type: 'object',
          description: '这次是从谁那儿借的（说不出 ⇒ 记空中取，不拒）',
          properties: {
            kind: { type: 'string', enum: Object.keys(L.LIFT_SOURCE) },
            at: { type: 'string', description: '具体是谁（先例名/路径、用户原话关键词、rid、查询词）' },
            got: { type: 'string', description: '借到了什么（一句话；search 时写查到了什么）' },
          },
          additionalProperties: false,
        },
        blank: { type: 'boolean', description: 'true = 承认这次想不出怎么升（要配 why + revisit）' },
        why: { type: 'string', description: '[blank] 为什么这次升不了（≥6 字）' },
        revisit: {
          type: 'object', description: '[blank] 什么条件下回来再试',
          properties: {
            kind: { type: 'string', enum: ['evidence', 'stage', 'user'] },
            at: { type: 'string' },
          },
          required: ['kind', 'at'], additionalProperties: false,
        },
        rid: {
          type: 'string',
          description: '（强烈建议）升维任务的**源 id**（如 R12，即 L-R12 的源）—— 给了就把变量集'
            + '**写回该升维任务**，机制**当场结算**（自动判「取/执」）。不给 ⇒ 只判、不记账，等于白判。',
        },
      },
      required: ['claimVariables', 'oldVariables'], additionalProperties: true,
    },
    output: jsonOutput(OPEN_OBJ),
    async execute(args) {
      const oldVars = args.oldVariables || []
      const claimVars = args.claimVariables || []
      const r = C.diagnoseLift({ variables: claimVars, claim: args.claim || '' }, oldVars)
      const lk = L.checkLift(args)
      let verdict = r.kind
      if (lk.grade === 'blank') verdict = '未决'
      else if (!lk.ok && r.kind === '取') verdict = '执'
      const isLift = verdict === '取'

      let settled = null
      if (args.rid) {
        settled = writeLiftClaim(st, { ...cfg, workDir }, args.rid, {
          vars: claimVars, oldVars, claim: args.claim, lift: lk,
        })
        if (!settled.ok) {
          diag({ ...cfg, workDir }, `lift_write rid=${args.rid} FAILED ${settled.why}`)
        } else {
          saveState(scoped(), st)
          diag({ ...cfg, workDir },
            `lift_write rid=${args.rid} verdict=${verdict} way=${lk.grade} still=${settled.autoStill} take=${settled.awaitingReceipt}`)
        }
      }

      return {
        verdict, isLift, newVariables: r.newVars, why: r.why,
        lift: { grade: lk.grade, way: lk.way || null, source: lk.source || null, note: lk.note || lk.why || '' },
        waysMenu: L.wayMenu(),
        settled,
        definition: '升维（取）＝ 换掉问题的表述层，让原矛盾不存在。'
          + '两个判据合起来用：① `new_vars = 新层变量集 − 旧层变量集 ≠ ∅`（只证多了一项）；'
          + '② 说得出用哪一招、从哪借（ladder/restate/separate/counter + source）—— 这才是"怎么升"。',
        note: verdict === '未决'
          ? `判「未决」——你承认这次想不出怎么升（${lk.why || lk.note || '已挂账'}）。`
            + '这不是失败，也不是通过：它挂着，到期（revisit 条件成立）机制会再问一次。'
          : isLift
            ? (settled?.ok
              ? `判「取」——手段：${lk.note || lk.grade}；变量集已写回并**当场结算**。`
                + '但「旧矛盾消没消失」是开放判断 ⇒ 仍需 brain_dissolve 回执三态。'
              : `判「取」——手段：${lk.note || lk.grade}；但**还没记账**：没给 rid ⇒ 机制那边仍算欠回执。`)
            : (lk.grade === 'none'
              ? `判「执」——${lk.why}`
              : (settled?.ok
                ? '判「执」——机制已自动判假（still，红灯进树）：这次升维换了说法没换层。'
                : '判「执」——守着一个已被判死的旧边界继续提问。要么补上真正的新变量，要么承认本层做不到。'
                  + '（第三种：`blank:true` + why + revisit，明说这次升不了、等什么时候再试）')),
      }
    },
    presentCall: () => ({ card: 'generic', title: '外置大脑·升维判据', kind: 'other', rawInput: {} }),
  })

  reg({
    name: 'brain_task',
    description:
      '外置大脑·声明任务：把**用户的话（你的原话）**记为最高权重的任务节点。'
      + '任务间可有依赖边（deps）—— 例：「因为他第一题答得不好，我才问第二题」⇒ 第二题 deps=[第一题]。'
      + '⚠️ 依赖边要保守：默认并列（不给 deps）；只有明确因果信号才补边。'
      +       '权重是**给定的**（用户的话 > 一切），不是分出来的。'
      + '⭐ 当两条要求互相拉扯（conflicts）时，**不许两条都满额** —— 必须有一条让步：'
      + 'weight < 100 + yield_to（让给哪条）+ cost（代价）。说不清代价的降权会被拒收。'
      + '⭐ 根预算：整件事允许被探究的总额度（默认 100），**任务从它里分出 weight，合计不许超**。'
      + '超了就是「什么都想做」，必须回根重新分配：要么给不做的任务降权，要么 root_budget 提高总量并说明为什么值。'
      + 'root 参数设「整件事是一句什么话」（根锚，唯一）；root_budget 设总量。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '任务编号，如 T1' },
        text: { type: 'string', description: '用户的原话（必填）' },
        deps: { type: 'array', items: { type: 'string' }, description: '依赖的任务编号（因果边，可空）' },
        conflicts: { type: 'array', items: { type: 'string' },
          description: '与哪几条任务**互斥**（两个要求不能同时满足）。声明了互斥就必须有一条让步' },
        weight: { type: 'number', description: '默认 100（用户的话满额）。<100 就是让步，必须配 yield_to + cost' },
        yield_to: { type: 'string', description: '让步给哪条任务（只有降权时才需要）' },
        cost: { type: 'string', description: '让步的代价是什么（具体到什么会缺、谁会受影响）' },
        root: { type: 'string', description: '★根锚：整件事是一句什么话（首次声明时设；之后只在用户的向变了才改）' },
        root_budget: { type: 'number', description: '★根预算：整件事允许消耗的总额度（默认 100）。只在「确实变大了」且能说清为什么时提高' },
        contradiction: { type: 'string', description: '★挂**主要任务**时必须给的矛盾节点 id（如 C0）：'
          + '新建任务前先用 `brain_contra op:"observe"` 建一条，说清这条任务要解决的是'
          + '「我与目标之间」哪一对拉扯（**哪两条路径走到同一个终点、结果不同**）。'
          + '判据是「指向真实节点」，不是「写一句话」—— 写一句话可以凑，指向 id 则要先把节点建出来；'
          + '做不到这一点时，就退回「写一句话」并在 reason 里说明为什么这次放宽。' },
        reading: { type: 'string', description: '★你怎么理解这条要求（2026-10-18 必填）：'
          + '「先要问他问题，首先是问题，然后他认为怎么样」—— 这一格写的是**你的判断**，不是用户的话。'
          + '要写出你从原话里读出的那个东西（它要什么、不要什么）；复述原文会被拒收——复述不是理解。它是取，会错，所以进账。' },
        because: { type: 'string', description: '★为什么要这样做（必填）：为什么是这个范围、为什么是现在、为什么不是别的做法。'
          + '答不出 ⇒ 说明这条你还只是在执行指令，没有判断，先别往下拆里程碑。' },
        want: { type: 'string', description: '★你要的结果长什么样（必填）：看到什么、拿到什么、哪件事成立，才算这条满足了。'
          + '它比 text 更具体 —— text 是用户的话，want 是你要交出来的那个东西。' },
        wants: {
          type: 'array',
          description: '（可选）把 want 拆成**可分别打分**的条目。每条 {text, weight 0-100, parent}。'
            + '不给 weight = 没打分（不是 0 分，两者含义不同）。'
            + 'parent 表示从属：用户说「权重之间有从属关系」⇒ 子条目的分是**在父那份里**再分，不是全局并列。',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              weight: { type: 'number' },
              parent: { type: 'string' },
            },
            required: ['text'],
            additionalProperties: false,
          },
        },
        origin: { type: 'string', description: '这条方向从哪来（只记账，不影响任何判定）：'
          + 'user=用户原话里就有 / ledger=盘上已欠的账（里程碑、矛盾、隐患）/ self=你自己推的。'
          + '不填可以（记为"未表态"）；填了别的值也收，但会记为未表态 —— 这一格不收拒，只收实话。' },
      },
      required: ['id', 'text'], additionalProperties: true,
    },
    output: jsonOutput(OPEN_OBJ),
    async execute(args) {
      if (!st.tree) st.tree = T.newTree()

      let newTaskContraNote = ''
      {
        const isNew = Boolean(String(args.id || '').trim())
          && !st.tree.tasks[args.id] && !(st.plan?.tasks || {})[args.id]
        const anyHooked = Object.values(st.tree.tasks || {})
          .some((t) => t && t.status !== 'dropped' && t.status !== 'invalid'
            && String(t.contradiction || '').trim())
        const hasNodes = Object.keys(st.contra?.nodes || {}).length > 0
        const needHook = isNew && hasNodes && !anyHooked
        if (isNew && args.action !== 'list') {
          const nodes = Object.keys(st.contra?.nodes || {})
          const want = String(args.contradiction || '').trim()
          if (want && !nodes.includes(want)) {
            return {
              ok: false, saved: false,
              why: `contradiction=${want} 不是现有矛盾节点（现有：${nodes.join(' / ') || '无'}）。`
                + '先用 `brain_contra op:"observe"` 把它建出来。',
            }
          }
          if (needHook && !want) {
            return {
              ok: false, saved: false,
              why: '这一批任务里**还没有一条挂过矛盾**，所以这一条必须先挂。\n'
                + '  怎么做：`brain_contra op:"observe"` 说清**哪两条路径走到同一个终点、结果不同**'
                + '（不是"差一层"、不是"做得不够"——那两种是欠账，该记成里程碑），'
                + '再把节点 id 填进 `contradiction`。\n'
                + '  为什么不能省：没有主矛盾，后面所有判据都失去参照系 ——'
                + '「连续失败 2 次」时答不出失败在逼近什么，「改判据第 2 次」时答不出改的是哪个方向。\n'
                + '  挂上之后，**同一批里的其他任务不必再挂**（那些是灵活分配的），账上只会亮一盏灯提醒。',
            }
          }
          if (!want) {
            newTaskContraNote = '这条任务没挂矛盾，可以 —— 同一批里已经有任务挂过了，细分任务是灵活分配的。'
              + (nodes.length ? `要挂就填 \`contradiction\`（现有：${nodes.join(' / ')}）` : '要挂就先 `brain_contra op:"observe"` 建一条')
              + '；账上会亮一盏「N 条任务没挂矛盾」的灯，方便回头补。'
          }
        }
      }

      {
        const rb = Number(args.root_budget)
        if (args.root_budget !== undefined && args.root_budget !== null
          && Number.isFinite(rb) && rb > 0 && rb !== Number(st.tree.budget || 100)) {
          const why = String(args.because || '').trim()
          if (why.length < 10) {
            return {
              ok: false, saved: false, lights: T.treeLights(st.tree),
              why: `抬总预算（${st.tree.budget || 100} → ${rb}）被拒：**必须说清为什么值**（because ≥10 字）。`
                + '\n  ⇒ 否则"抬预算"就是绕过飞沙堰最省事的那条路（比"承认做不完"省力得多）。',
            }
          }
          st.tree.prev_budget = Number(st.tree.budget || 100)
          st.tree.budget = rb
          st.tree.budget_raised = { at: new Date().toISOString(), to: rb, why: why.slice(0, 200) }
          diag({ ...cfg, workDir }, `sand raise-budget ${st.tree.prev_budget}->${rb}`)
        }
        const total = Number(st.tree.budget || 100)
        const spent = Number(st.tree.spent || 0)
        const usedNow = Object.values(st.tree.tasks || {})
          .filter((t) => t && t.id !== 'META' && t.status !== 'superseded' && t.status !== 'invalid')
          .reduce((a, t) => a + (Number(t.weight) || 0), 0)
        const pctUsed = total > 0 ? usedNow / total : 0
        const pctSpent = total > 0 ? spent / total : 0
        const pct = pctSpent
        const prevW = Number(((st.tree.tasks || {})[args.id] || {}).weight)
        const nextW = args.weight === undefined || args.weight === null ? prevW : Number(args.weight)
        const isShrink = (Number.isFinite(prevW) && Number.isFinite(nextW) && nextW < prevW)
          || args.status === 'dropped'
        if (pctUsed >= 0.95 && !isShrink) {
          return {
            ok: false, saved: false, lights: T.treeLights(st.tree),
            why: `「开新账」被拒（飞沙堰 · **摊得太宽**）：任务已分配 ${usedNow}/${total}（${Math.round(pctUsed * 100)}%）`
              + '\n  ⇒ 这一侧的问题是「方向太多」，出口是**取舍**：'
              + '① 先把已开的账收口（把不做了的标 dropped 并写 why，或降权让位给更重要的）；'
              + '② 或者这条确实更重要 ⇒ 抬总预算（root_budget）并说明为什么值。'
              + '\n  ⇒ 注意：这一侧**不是**"干得太久"，那个由「钻得深」那个闸管（spent）。',
          }
        }
        if (pctSpent >= 0.95 && !isShrink) {
          return {
            ok: false, saved: false, lights: T.treeLights(st.tree),
            why: `「开新账」被拒（飞沙堰 · **钻得太深**）：工具调用已用 ${spent}/${total}（${Math.round(pctSpent * 100)}%）`
              + '\n  ⇒ 这一侧的问题是「同一个方向钻太久」，出口是**知止**：'
              + '① 按飞沙堰收口：把已有的成果冻结、标待定、写清差什么；'
              + '② 或者换层（升维 / 降维 / 换域）；'
              + '③ 抬总预算也行，但要说明为什么这一轮还值（because ≥10 字）。'
              + '\n  ⇒ 注意：这一侧**不是**"方向太多"，降权在这里不管用（降权只改分配，不改消耗）。',
          }
        }
        if (pctUsed >= 0.8 || pctSpent >= 0.8) {
          diag({ ...cfg, workDir }, `sand warn task=${args.id} used=${usedNow}/${total}(${Math.round(pctUsed * 100)}%) spent=${spent}/${total}(${Math.round(pctSpent * 100)}%)`)
        }
      }

      const prevTask = (st.tree.tasks || {})[args.id] || {}
      const hasTaskId = Boolean(String(args.id || '').trim())
      if (!hasTaskId && !String(args.root || '').trim()) {
        if (args.root_budget !== undefined || args.root !== undefined) {
        } else {
          return { ok: false, saved: false, lights: T.treeLights(st.tree),
            why: '这条调用既没有 id（声明哪条任务），也没有 root / root_budget（调什么参数）—— 不知道该做什么。' }
        }
      }
      const q = hasTaskId
        ? P.checkTaskReading(args.id, args.text || prevTask.text, {
          reading: args.reading || prevTask.reading,
          because: args.because || prevTask.because,
          want: args.want || prevTask.want,
        })
        : { ok: true, reading: null, because: null, want: null }
      if (!q.ok) return { ok: false, saved: false, lights: T.treeLights(st.tree), why: q.why }
      const qReading = q.reading
      const qBecause = q.because
      const qWant = q.want

      if (args.root !== undefined && args.root !== null && String(args.root).trim()) {
        st.tree.root = String(args.root).trim()
      }
      const r = T.declareTask(st.tree, {
        id: args.id, text: args.text, deps: args.deps || [],
        conflicts: args.conflicts || [], weight: args.weight, yield_to: args.yield_to, cost: args.cost,
        reading: qReading, because: qBecause, want: qWant,
        contradiction: args.contradiction,
        wants: args.wants,
        origin: args.origin,
        textSuspect: T.checkTaskText(args.text, st.last_user_text).suspect,
        textIsCommand: T.looksLikeCommand(args.text, st.last_user_text),
        goalCheck: P.checkGoalIsomorphism(args.want, args.text),
        textOfftopic: T.looksOffTopic(args.text, st.last_user_text).off,
        seq: st.matrix?.seq ?? null,
      })
      let fish = null
      try {
        const w = Number(args.weight === undefined ? 100 : args.weight)
        const contraN = Object.values(st.contra?.nodes || {}).filter((x) => x && x.status !== 'solved' && x.status !== 'redefined').length
        const unkN = Object.values(st.unknown?.items || {}).filter((u) => u && (u.state === 'raw' || u.state === 'classified')).length
        const depN = Array.isArray(args.deps) ? args.deps.length : 0
        fish = TERR.fishMouth({
          impact: Math.max(0, Math.min(1, w / 100)),
          uncertainty: Math.max(0, Math.min(1, (contraN + unkN) / 5)),
          coupling: Math.max(0, Math.min(1, depN / 3)),
        })
      } catch (e) { fish = null }

      const saved = saveState(scoped(), st)
      if (fish && fish.level === 'light') {
        diag({ ...cfg, workDir }, `fish task=${args.id} light（impact/uncertainty/coupling 推自账）`)
      }
      diag({ ...cfg, workDir }, `task ${args.id} ok=${r.ok} w=${r.weight} root=${st.tree.root ? 'set' : 'null'}`
        + ` budget=${st.tree.budget}`)

      let jevAsk = null
      try {
        const jd = await JEV.decide({
          state: `用户原话：${String(st.last_user_text || '').slice(0, 100)}｜我准备干：${String(args.text || '').slice(0, 60)}`,
          questions: {
            enough: { type: 'noul', instructions: 'Is the user instruction specific enough to start work without asking back?' },
            next: { type: 'choice', instructions: 'What should happen next?', criteria: { act: 'start working', ask: 'ask the user first' } },
          },
          timeoutMs: 6000,
        })

        if (!jd.degraded) {
          const act = jd.answers?.next?.choice || jd.answers?.next_move?.choice || '(none)'
          diag({ ...cfg, workDir }, `jev task=${args.id} act=${act} strength=${Number(jd.strength).toFixed(3)}（不据此提示：标定说它判别力为 0）`)
        }
      } catch (e) {
        diag({ ...cfg, workDir }, `jev task=${args.id} 降级 ${String(e.message || e).slice(0, 50)}`)
      }
      return {
        ok: r.ok, id: args.id, weight: r.weight,
        root: st.tree.root ?? null,
        root_budget: st.tree.budget ?? T.ROOT_BUDGET,
        budget_raised: st.tree.budget_raised ?? null,
        prev_budget: st.tree.prev_budget ?? null,
        root_pressure: T.pressure(st.tree, null),
        ...(jevAsk ? { jev_ask: jevAsk } : {}),
        deps: (st.tree.tasks[args.id] || {}).deps || [],
        ...(newTaskContraNote ? { contradiction_hint: newTaskContraNote } : {}),
        conflicts: (st.tree.tasks[args.id] || {}).conflicts || [],
        yield_to: (st.tree.tasks[args.id] || {}).yield_to ?? null,
        cost: (st.tree.tasks[args.id] || {}).cost ?? null,
        lights: T.treeLights(st.tree),
        ...(() => {
          const notes = []
          const tt = T.checkTaskText(args.text, st.last_user_text)
          if (tt.suspect) {
            diag({ ...cfg, workDir }, `task text-suspect ${args.id} hits=${tt.hits.join(',')}`)
            notes.push(`⚠️ ${tt.why}。任务文本应当是**用户原话**；你的判断写进 reading/because/want。`)
          }
          const cmdLike = T.looksLikeCommand(args.text, st.last_user_text)
          if (cmdLike) {
            notes.push('⚠️ 这句看起来是**口令**（如「开机制」），不是任务：它只说明机制该接管，没说要做什么。'
              + '要自己找活就标 origin:"self"，并在回复里写明「这条是我自己找的」。')
          }
          const off = T.looksOffTopic(args.text, st.last_user_text)
          if (off.off) notes.push(`⚠️ ${off.why} —— 账上那条不是他说的话。`)
          const gc = P.checkGoalIsomorphism(args.want, args.text)
          if (gc.mismatch) notes.push(`💡 ${gc.why}`)
          return notes.length ? { text_checked: true, text_suspect: tt.suspect ? tt.hits : null, notes } : { text_checked: Boolean(st.last_user_text) }
        })(),
        note: r.ok
          ? (r.weight < T.TASK_WEIGHT
            ? `任务已记，已让步到 ${r.weight}（让给 ${args.yield_to}，代价：${args.cost}）`
            : '任务已记。权重=给定（你的话最高）。')
          : r.why,
        saved,
      }
    },
    presentCall: () => ({ card: 'generic', title: '外置大脑·声明任务', kind: 'other', rawInput: {} }),
  })

  const planSitFor = (s) => ({
    rids: Object.keys(s?.pool?.entries || {}),
    ids: [
      ...Object.keys(s?.tree?.questions || {}),
      ...Object.keys(s?.tree?.tasks || {}),
      ...Object.keys(s?.plan?.milestones || {}),
    ],
    text: String(s?._lastUserText || ''),
  })

  reg({
    name: 'brain_plan',
    description:
      '外置大脑·交付账：把用户任务拆成**里程碑**（你自己列，自己改）。'
      + '⭐ 三条硬要求：① 挂 task（用户任务；不挂就悬空，账上没人认）② 有 output（交付物：文件/命令/URL/可核的数）'
      + '③ 有 done_when（判据）——没有交付物的里程碑是感想，没有判据的里程碑到不了 done。'
      + '⭐ 第三条之前还有一条（2026-10-18 用户：「提交东西时先定义东西，把局限性讨论清楚，定义就是取」）：'
      + '**`define` 必填**（is 它是什么 / not 它不管什么 / limit 什么情况下这定义不成立）。'
      + '复述 text 不算定义；`not` 里必须有"不管/不是/不包括/只限"这类收窄，否则读起来就是把 is 又写了一遍。'
      + '改 define 会让里程碑**回到 pending** —— 定义一改，原来那个绿是在旧定义下得的。'
      + '① 的边界：里程碑只能挂到**已存在**的用户任务上；任务还没登记就先 brain_task，否则挂空。'
      + '不许自己造 task 编号糊过去，否则机制自派的 `S-OBS-*` 会重新混进交付账。'
      + '③ 的边界（2026-10-18）：说不出外部可执行判据时（探究类里程碑），出口是把它降级成 `brain_question`'
      + '（方向），**不是**编一条"能跑通"的命令冒充判据 —— 真机 M1/M2 就是同一条 `node selfcheck-panel.mjs` '
      + '判绿了"均线周期可调"和"副图指标可调"两件不同的话。反证：判据从没红过，它就不是判据，是装饰。'
      + 'done_when 只收两种：`cmd`（机制真跑命令看退出码，首选）／`evidence`（给本地路径，机制验存在）。'
      + '⚠️ `mode:"self"` 会被拒 —— 「自己说自己做完」不是判据，是幻觉的唯一入口。'
      + '⭐ 中途改计划是**正当的**（发现新情况就 revise）：但改判据会让该里程碑回到 pending 并留痕 —— '
      + '这是「根据实际情况调整」与「把判据改软直到变绿」的分界。'
      + 'action=list 只看不写。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['put', 'list'], description: 'put=记/改一条里程碑；list=看交付进度' },
        id: { type: 'string', description: '里程碑编号，如 M1（同 id 再 put = 改）' },
        task: { type: 'string', description: '挂哪条用户任务（用 brain_task 声明过的 id）' },
        text: { type: 'string', description: '这一步到底要**成什么**（不是"做什么动作"，是"什么成立"）' },
        output: { type: 'string', description: '★交付物（必填）：文件路径 / 命令 / URL / 可核的数' },
        define: {
          type: 'object',
          description: '★定义：提交之前先把这件事定义清楚。**三种表态方式，选一种**——'
            + '① `state:"given"`（或省略 state）＋ `is`/`not`/`limit`：我现在就这么定，可能错；'
            + '② `state:"blank"` ＋ `why`（为什么现在给不出）/ `scope`（空的是哪一段）/ '
            + '`revisit:{kind:"evidence"|"stage"|"user", at:"rid-xxx 或节点 id 或用户原话关键词"}`：'
            + '**现在不知道就诚实留空，机制会挂到期、到期催你**——空着不是免罪，只是把判断推迟到一个能判定的时刻；'
            + '③ `state:"redef"` ＋ `was`/`now`/`why`：原来那个说法不存在了（换了表述或换了层），旧义务销账留痕。'
            + '三种都收。**拒收只发生在一种情况：什么都没说** —— 那既不是取，也不是不取，是没表态。'
            + '为什么这样设计：早先这里是"填齐 or 拒收"，于是人在不知道的时候会去编一个能过的；'
            + '「必填」逼出来的不是诚实，是编造（2026-10-18 用户点破，见 DEFECTS 第 39 条）。'
            + '代价：给定的全重；留空的按 0.6 折进进度；没表态的按 0 算并亮 🔴。',
          properties: {
            state: { type: 'string', enum: ['given', 'blank', 'redef'],
              description: 'given=给（默认）／blank=留空（要 why+scope+revisit）／redef=重定义（要 was+now+why）' },
            is: { type: 'string', description: '[given] 成了的时候是什么样（一句话，拿具体例子能判是/不是）' },
            not: { type: 'string', description: '[given] 它不管什么（边界：哪些情况出现了也不算它成）' },
            limit: { type: 'string', description: '[given] 什么情况下这个定义不成立、要重定义（可推翻条件）' },
            why: { type: 'string', description: '[blank/redef] 为什么现在给不出 ／ 为什么旧的那个不存在了（≥6 字）' },
            scope: { type: 'string', description: '[blank] 空的是哪一段／哪一问（"整块不知道"和"not 不知道"是两件事）' },
            revisit: {
              type: 'object',
              description: '[blank] 什么条件下回来填。at 要指向盘上真有的东西，写"以后再说"会被拒（到期判定跑不了）',
              properties: {
                kind: { type: 'string', enum: ['evidence', 'stage', 'user'] },
                at: { type: 'string', description: 'evidence⇒rid；stage⇒节点/里程碑 id；user⇒用户原话关键词' },
              },
              required: ['kind', 'at'], additionalProperties: false,
            },
            was: { type: 'string', description: '[redef] 原来那个说法是什么（不留旧值就分不清是重定义还是逃避）' },
            now: { type: 'string', description: '[redef] 现在这个说法是什么' },
          },
          additionalProperties: false,
        },
        why: { type: 'string', description: '为什么这一步必须现在做（为什么不是别的）' },
        done_when: {
          type: 'object',
          description: '★判据（必填）：{mode:"cmd", cmd:"node x.mjs", expect_exit:0} 或 '
            + '{mode:"evidence", artifacts:["path/a.png","path/b.html"]}',
          properties: {
            mode: { type: 'string', description: 'cmd | evidence（self 会被拒）' },
            cmd: { type: 'string', description: 'mode=cmd 时必填：可原样执行的命令' },
            expect_exit: { type: 'number', description: 'mode=cmd 的期望退出码（默认 0）' },
            artifacts: { type: 'array', items: { type: 'string' },
              description: 'mode=evidence 时必填：本地路径清单（URL 请改用 cmd + curl，当场验）' },
          },
          required: ['mode'], additionalProperties: true,
        },
        status: { type: 'string', enum: ['dropped', 'pending'], description: '★处置：dropped=我决定不做（请同时给 dropped_why，否则等于悄悄删账）；pending=撤销之前的 dropped（会同时清掉 dropped_why）。done 只能靠 brain_verify 验出来。' },
        dropped_why: { type: 'string', description: '★为什么不做（≥10 字）。没有 why 的 dropped 等于悄悄删账，会被拒收。' },
        advances: { type: 'string',
          description: '（可选）这条活推进了 `task.wants[]` 里的哪一条（填 want 的 id，如 W1）。'
            + ' ⚠️ 它**不算改判据**（不进 revision、不加 boundary_seq）—— 它只回答"这条活为什么存在"。' },
        touches: { type: 'object',
          description: '（可选，但改代码的里程碑应当填）这次改动触及的代码对象与各自的消费点。'
            + ' why=为什么动它；consumers=全部要跟着改的地方（文件#函数名）；second_impl=同一件事的第二份实现。'
            + ' ⚠️ 落了盘就会在 brain_status 里聚合，接手的人不必靠记忆。' },
      },
      required: ['action'], additionalProperties: true,
    },
    output: jsonOutput(OPEN_OBJ),
    async execute(args) {
      if (!st.plan) st.plan = P.newPlan()
      st.plan.tasks = JSON.parse(JSON.stringify(st.tree?.tasks || {}))

      if (args.action === 'list' || !args.action) {
        const all = P.deliveryAll(st.plan, st.tree?.tasks)
        return {
          ok: true, action: 'list',
          delivery: all, lights: P.planLights(st.plan, st.tree?.tasks, planSitFor(st)),
          line: P.deliveryLine(st.plan, st.tree?.tasks),
          milestones: Object.values(st.plan.milestones || {}).map((m) => ({
            id: m.id, task: m.task, text: m.text, output: m.output,
            weight: m.weight, status: m.status, mode: m.done_when?.mode,
            dropped_why: m.dropped_why || '', boundary_seq: Number(m.boundary_seq || 0),
            verify_n: Number(m.verify_n || 0), verified: (m.evidence || []).length,
            advances: m.advances ?? null,
          })),
          note: Object.keys(all).length ? P.deliveryLine(st.plan, st.tree?.tasks) : '（树上没有用户任务）',
        }
      }

      const existsId = (id) => {
        const k = String(id)
        if (!k) return false
        if (st.tree?.questions?.[k] || st.tree?.tasks?.[k]) return true
        if (st.plan?.milestones?.[k]) return true
        if (st.pool?.entries?.[k]) return true
        const pref = (arr) => arr.filter((x) => String(x).startsWith(k))
        const cands = [
          ...Object.keys(st.tree?.questions || {}),
          ...Object.keys(st.tree?.tasks || {}),
          ...Object.keys(st.plan?.milestones || {}),
          ...Object.keys(st.pool?.entries || {}),
        ]
        return pref(cands).length === 1
      }
      if (args.status === 'dropped' && String(args.dropped_why || '').trim().length < 10) {
        return {
          ok: false, id: args.id,
          why: 'status=dropped 必须同时给 dropped_why（≥10 字）：说不出"为什么不做"，那就不是处置，是悄悄删账。\n'
            + '要么把它做完（brain_verify 验绿），要么写清为什么不做了。',
        }
      }
      const r = P.putMilestone(st.plan, {
        id: args.id, task: args.task, text: args.text, output: args.output, why: args.why,
        define: args.define,
        done_when: args.done_when,
        status: args.status, dropped_why: args.dropped_why,
        advances: args.advances,
        touches: args.touches,
      }, st.tree?.tasks || {}, {
        exists: existsId,
        contraRecent: (() => {
          const out = []
          for (const n of Object.values(st.contra?.nodes || {})) {
            for (const a of (n.attempts || [])) if (a?.at) out.push(String(a.at))
          }
          return out.sort().slice(-5)
        })(),
      })
      const saved = saveState(scoped(), st)
      diag({ ...cfg, workDir }, `plan ${args.id || '-'} ok=${r.ok} task=${args.task || '-'}`
        + ` weight=${r.weight ?? '-'} revised=${r.revised ? 1 : 0} reset=${r.reset ? 1 : 0}`)
      return {
        ok: r.ok, id: args.id, weight: r.weight ?? null,
        status: r.status ?? null, dropped_why_set: r.dropped_why_set === true,
        define_warn: r.node?.define?.define_warn || null,
        define_state: r.node?.define?.state || null,
        boundary_hint: (() => {
          try {
            const bs = Number(st.plan?.milestones?.[args.id]?.boundary_seq || 0)
            if (!r.ok || bs < 3) return null
            return `边界已改过 ${bs} 次（上限 3）—— **再改也只是换个说法**，陪审不会因此 pass。`
              + ' 三条出口，选一条：① 缩小 claim（真子集）；② brain_escalate 上报要资源；③ dropped（写清 dropped_why）。'
          } catch { return null }
        })(),
        advances: st.plan?.milestones?.[args.id]?.advances ?? null,
        touches: (() => {
          const cur = st.plan?.milestones?.[args.id]?.touches || null
          if (!cur) return null
          const objs = Object.keys(cur)
          const points = objs.reduce((n, k) => n + (Array.isArray(cur[k]?.consumers) ? cur[k].consumers.length : 0), 0)
          return { objs: objs.length, points, keys: objs }
        })(),
        siblings: r.siblings ?? null, evenly: r.evenly ?? null,
        revised: !!r.revised, changes: r.changes || [], reset: !!r.reset,
        lights: P.planLights(st.plan, st.tree?.tasks, planSitFor(st)),
        note: r.ok
          ? (r.reset
            ? `已改（${r.changes.join('；')}）。★ 因判据变了，该里程碑**回到 pending** —— `
              + '要重新跑一次 brain_verify 才算绿（改判据不许顺带保住绿）。'
            : `里程碑已记，权重 ${r.weight}（${r.siblings} 个兄弟均分父额度 ${st.plan.tasks?.[args.task]?.weight}）。`
              + '下一步：跑 brain_verify 把判据执行一次 —— 没跑过的判据只是声明。')
          : r.why,
        ...(() => {
          if (!r.ok) return {}
          try {
            const atk = FAL.attack({ claim: String(args.text || ''), doneWhen: args.done_when || {}, kind: (args.done_when || {}).mode })
            if (!atk.ok || !atk.shots.length) return {}
            return {
              falsify_pre: {
                note: '这条判据**还没跑过**。下面是它可能"假绿"的角度——先想一遍，能省掉一轮真撞墙：',
                shots: atk.shots.slice(0, 3).map((x) => `${x.angle}：${x.try}`),
              },
            }
          } catch { return {} }
        })(),
        saved,
      }
    },
    presentCall: () => ({ card: 'generic', title: '外置大脑·交付账', kind: 'other', rawInput: {} }),
  })

  reg({
    name: 'brain_verify',
    description:
      '外置大脑·跑判据：**唯一**能把里程碑判成 done 的入口。'
      + 'mode=cmd ⇒ 机制真跑那条命令，退出码对得上才算绿（有超时）；'
      + 'mode=evidence ⇒ 机制逐条验本地路径存在且非空（URL 一律拒，改用 cmd + curl 当场验）。'
      + '⭐ 机械判据通过后，机制**自动开庭陪审**（3 个互不通气的评审员，只看硬事实、不看你的理由，多数决）'
      + '—— 你不用申请，也不能指定谁审、不能复议。'
      + '陪审不过 ⇒ 里程碑**不绿**：fail=补它指名的那件证据；unclear=判据本身含糊，改 done_when；'
      + 'unavailable=机制没开成庭 ⇒ 本条未经陪审复核（抓错未验证），但**交付不挡**，欠一次开庭待补审。'
      + '**重跑同一条命令不会改变陪审结论。**'
      + '判负不改 done，但**证据照留**（证据不灭）。不交本工具、只自己在回复里说"做完了" ⇒ 账上永远是 pending。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '里程碑编号' },
        note: { type: 'string', description: '这次跑的是什么（可复核：命令/环境/数据版本）' },
        can_coexist: { type: 'boolean', description: '（可选）这对矛盾能否**共存** —— 能则中段强度走「平衡」' },
        can_transfer: { type: 'boolean', description: '（可选）能否把矛盾**转移到别处** —— 能则走「转移」（代价：反弹时间 ∝ 距离）' },
        can_take_void: { type: 'boolean', description: '（可选）能否从「无」里取一个**对冲变量** —— 能则走「取无」' },
        can_raise: { type: 'boolean', description: '（可选，默认 true）能否找到**可升的新基** —— 高矛盾时填 false 就转人工' },
        proof: { type: 'array', items: { type: 'string' },
          description: '【举证】前提（每条带来源）→ 推导步骤 → 结论。例：前提1：QPS=1000（来源：监控）/ 推导1：由前提1… / 结论：…' },
        assumptions: { type: 'array', items: { type: 'string' },
          description: '【举证】这次依赖了哪些假设（每条写清「若假设错了会怎样」）。假设错了整条证明作废。' },
        pending: { type: 'array', items: { type: 'string' },
          description: '【举证】**你自己认的「没解决」**（≠ 陪审的 missing）。两个都记，才能看出「你以为做完了、陪审不认」。' },
      },
      required: ['id'], additionalProperties: true,
    },
    output: jsonOutput(OPEN_OBJ),
    async execute(args) {
      if (!st.plan) st.plan = P.newPlan()
      const m = st.plan.milestones?.[String(args.id)]
      if (!m) return { ok: false, why: `里程碑 ${args.id} 不存在（先 brain_plan action=put）`, saved: false }
      const mode = m.done_when?.mode
      let result = null

      const guessRepoDir = () => {
        const cmd = String(m.done_when?.cmd || '')
        const re = /[\w.\-\\\/]+\.(?:mjs|cjs|js|ts|tsx|jsx|py|json)/g
        const hit = (cmd.match(re) || []).map((x) => x.replace(/^"|"$/g, ''))[0]
        let d = workDir
        if (hit) {
          const abs = /^[A-Za-z]:[\\\/]/.test(hit) ? hit : resolve(workDir, hit)
          d = dirname(abs)
        }
        for (let i = 0; i < 6; i++) {
          try { if (existsSync(resolve(d, '.git'))) return d } catch {}
          const up = dirname(d)
          if (up === d) break
          d = up
        }
        return workDir
      }
      const snapGit = () => {
        try {
          const dir = guessRepoDir()
          const out = execSync('git status --porcelain', { cwd: dir, timeout: 15000, stdio: 'pipe', shell: true })
          return String(out ?? '').split(/\r?\n/).filter(Boolean).map((l) => l.slice(3).trim())
        } catch { return null }
      }
      const gitNow = snapGit()
      const gitPrev = Array.isArray(st.plan._lastGitSnapshot) ? st.plan._lastGitSnapshot : null
      const changedSinceLast = (gitNow && gitPrev)
        ? gitNow.filter((f) => !gitPrev.includes(f))
        : null

      const cg = P.channelGate(st.plan, args.id)
      if (cg.blocked) {
        const saved1 = saveState(scoped(), st)
        diag({ ...cfg, workDir }, `verify need-channel id=${args.id}（边界未变，未跑命令未开庭）`)
        return {
          ok: true, id: String(args.id), status: m.status, passed: false,
          verdict: 'need-channel', why: cg.why, hint: cg.hint,
          note: '这条**没跑命令、没开庭** —— 先把边界改一次（改 define / 改 done_when / 换断言），再 verify。',
          saved: saved1,
        }
      }

      if (mode === 'cmd') {
        const cmd = String(m.done_when.cmd || '')
        const t0 = Date.now()
        try {
          const out = execSync(cmd, { cwd: workDir, timeout: 120000, stdio: 'pipe', shell: true })
          result = { mode: 'cmd', exit: 0, ms: Date.now() - t0, stdout: String(out ?? '') }
        } catch (e) {
          result = {
            mode: 'cmd',
            exit: (typeof e?.status === 'number') ? e.status : 1,
            ms: Date.now() - t0,
            stdout: String(e?.stdout ?? ''),
            note: `原始命令：${cmd}`,
            failed: true,
          }
        }
      } else if (mode === 'pair') {
        const cmd = String(m.done_when.cmd || '')
        const mutatePath = String(m.done_when.mutatePath || '')
        const claimPath = String(m.done_when.claimPath || mutatePath)
        const hasPath = (f) => {
          try {
            const o = JSON.parse(readFileSync(f, 'utf8'))
            const parts = mutatePath.split('.').filter(Boolean)
            let t = o
            for (const p of parts) { if (t == null) return false; t = t[p] }
            return t !== undefined
          } catch { return false }
        }
        const cands = []
        const sp = statePaths(scoped())
        if (sp.file) cands.push(sp.file)
        if (activeScope) cands.push(join(workDir, 'projects', activeScope, 'outer-brain-state.json'))
        const stateFile = cands.find((f) => f && existsSync(f) && hasPath(f)) || cands.find((f) => f && existsSync(f)) || null
        const pr = stateFile
          ? PAIR.runPair({ cmd, cwd: workDir, statePath: stateFile, mutatePath, claimPath,
              expectExit: m.done_when.expect_exit === undefined ? 0 : m.done_when.expect_exit })
          : { ok: false, normalExit: null, mutantExit: null, sameField: claimPath === mutatePath, restored: false, why: '找不到含该字段的状态文件（候选：' + cands.join(' | ') + '）' }
        result = {
          mode: 'pair',
          pair: { normalExit: pr.normalExit, mutantExit: pr.mutantExit, sameField: pr.sameField },
          exit: pr.normalExit,
          stdout: [
            `【同址翻红 · 第一次（字段非空）】退出码 ${pr.normalExit}`,
            String(pr.normalOut || '').slice(0, 1200),
            `【把 ${mutatePath} 写空后 · 第二次】退出码 ${pr.mutantExit}`,
            String(pr.mutantOut || '').slice(0, 1200),
            `【还原】${pr.restored ? '字节相等' : '失败'}`,
          ].join('\n'),
          covers: [
            `state=${stateFile || '（无）'}`,
            `mutate=${mutatePath}`,
            `normal=${pr.normalExit}`,
            `mutant=${pr.mutantExit}`,
            `same=${pr.sameField}`,
            `restored=${pr.restored}`,
            `why=${pr.why || '（无）'}`,
          ],
          restored: pr.restored,
          timedOut: pr.timedOut === true,
          failed: !pr.ok,
        }
      } else if (mode === 'evidence') {
        const want = (m.done_when.artifacts || []).map(String)
        const found = []
        const bad = []
        for (const a of want) {
          if (/^https?:\/\//i.test(a)) { bad.push(`${a}（URL 不能当场验，改用 cmd + curl）`); continue }
          try {
            const p = resolve(workDir, a)
            if (existsSync(p) && statSync(p).size > 0) found.push(a)
            else bad.push(`${a}（不存在或空文件）`)
          } catch (e) { bad.push(`${a}（${String(e?.message || e)}）`) }
        }
        result = { mode: 'evidence', found, missing: bad }
      } else {
        return { ok: false, why: `里程碑 ${args.id} 的判据形态 ${mode || '（空）'} 不受支持`, saved: false }
      }

      const wantExit = m.done_when.expect_exit === undefined ? 0 : m.done_when.expect_exit
      const machinePass = (mode === 'cmd')
        ? Number(result.exit) === wantExit
        : (mode === 'pair')
          ? (result.pair?.sameField === true && result.failed === false && result.restored === true)
          : (mode === 'evidence')
            ? (result.missing || []).length === 0
            : false
      let jury = null
      let juryLineText = ''
      let selfHint = ''
      if (machinePass) {
        const gate = P.selfRefGate(st.plan, args.id)
        if (gate.blocked) {
          const saved0 = saveState(scoped(), st)
          diag({ ...cfg, workDir }, `verify selfref-block id=${args.id}（未开庭）`)
          return {
            ok: true, id: String(args.id), status: m.status, passed: false,
            why: `${gate.why} —— 本条**没开庭**（不是判负，是判据形状错）`,
            verdict: 'malformed', hint: gate.hint,
            note: '改 claim（把"我证明我没说谎"改成"任何人复跑都能判真假"）后再 verify；'
              + '同一条命令重跑不会改变结论。',
            saved: saved0,
          }
        }
        if (gate.hint) selfHint = gate.hint
      }
      if (machinePass) {
        const artifacts = mode === 'evidence'
          ? (m.done_when.artifacts || []).map((a) => {
            const p = resolve(workDir, String(a))
            try {
              const s = statSync(p)
              return { path: String(a), exists: true, size: s.size, mtime: s.mtime.toISOString() }
            } catch { return { path: String(a), exists: false } }
          })
          : null

        const jr = await runJury({
          goal: String(st.tree?.tasks?.[m.task]?.text || ''),
          claim: String(m.text || ''),
          done_when: m.done_when,
          facts: {
            cmd: mode === 'cmd' ? String(m.done_when.cmd || '') : null,
            expect_exit: mode === 'cmd' ? wantExit : null,
            exit: result.exit, ms: result.ms, stdout: result.stdout,
            artifacts, missing: result.missing,
            dup_cmd_milestones: J.dupCmdHits(st.plan, args.id),
            siblings: Object.values(st.plan?.milestones || {})
              .filter((x) => x && x.id !== args.id && x.task === m.task)
              .map((x) => ({
                id: x.id, status: x.status,
                cmd: (x.done_when && x.done_when.cmd) || (x.done_when && x.done_when.mode) || '',
                claim: String(x.text || '').slice(0, 90),
              })),
          },
          declared: String(args.note || ''),
          history: (m.evidence || []).slice(-3).map((e) => e.jury).filter(Boolean),
        })
        jury = jr.rec
        juryLineText = J.juryLine(jury)
      }
      const r = P.judgeDone(st.plan, args.id, {
        ...result,
        note: args.note || '',
        jury,
        covers: Array.isArray(args.covers) ? args.covers : result?.covers,
        changed: changedSinceLast,
        git_ok: Array.isArray(gitNow),
        submission: {
          proof: Array.isArray(args.proof) ? args.proof : [],
          assumptions: Array.isArray(args.assumptions) ? args.assumptions : [],
          pending: Array.isArray(args.pending) ? args.pending : [],
        },
      })
      st._verifyLog = [...(st._verifyLog || []).slice(-8), { target: String(args.id) + '#r' + (Array.isArray(m.revision) ? m.revision.length : 0), at: new Date().toISOString() }]
      const sp = SPIN.detect(st._verifyLog)
      if (sp.repeating) {
        diag({ ...cfg, workDir }, `spin verify=${args.id} streak=${sp.streak} layer=${sp.layer} mustStop=${sp.mustStop}`)
      }

      if (Array.isArray(gitNow)) st.plan._lastGitSnapshot = gitNow
      const saved = saveState(scoped(), st)
      diag({ ...cfg, workDir }, `verify ${args.id} mode=${mode} status=${r.status}`
        + ` pass=${r.status === 'done' ? 1 : 0}`
        + ` jury=${jury ? jury.decision : '-'}`
        + ` why=${String(r.why).slice(0, 80)}`)
      const d = P.deliveryOf(st.plan, m.task)
      return {
        ok: true, id: args.id, status: r.status, passed: r.status === 'done',
        why: r.why, delivery: d,
        ...(selfHint ? { selfref_hint: selfHint } : {}),
        jury: jury ? {
          decision: jury.decision, why: jury.why,
          support: jury.support, insufficient: jury.insufficient, undecidable: jury.undecidable,
          external: jury.external ?? 0,
          unanimous: jury.unanimous, missing: jury.missing, dissent: jury.dissent,
          gaps: jury.gaps || [],
        } : null,
        ...(() => {
          const notes = []
          const ms = Number(result?.ms || 0)
          if (ms > 30000) {
            const pieces = Math.ceil(ms / 30000)
            notes.push(`⏱ 宝瓶口：这条判据跑了 ${(ms / 1000).toFixed(0)}s（>30s）⇒ 建议拆成约 ${pieces} 步，每步各给退出码。`
              + `\n  （慢判据会被绕着走 —— 今天那条"跑满 120 秒后返回 1"的判据，陪审正是判它「证明不了红因」。）`)
          }
          try {
            const wl = UNK.waterline(st.unknown, cfg || {})
            if (wl.over) {
              notes.push(`🌊 水位线：未知池 ${wl.open} 条 > ${wl.limit} ⇒ 原文口径「未处理超线不许标完成」。`
                + `\n  ⇒ 先分类或拒收（reject 要写理由）；处理完再来说"做完了"。`)
            }
          } catch {}
          return notes.length ? { terrain_notes: notes } : {}
        })(),
        jury_line: juryLineText,
        ...(() => {
          try {
            const stl = P.stalledOf(st.plan?.milestones?.[args.id])
            return stl ? { stalled: stl } : {}
          } catch { return {} }
        })(),
        ...(() => {
          try {
            const mm = st.plan?.milestones?.[args.id]
            const stl = P.stalledOf(mm)
            const d = P.decideAction(mm, {
              stalled: Boolean(stl),
              canCoexist: args.can_coexist === true,
              canTransfer: args.can_transfer === true,
              canTakeVoid: args.can_take_void === true,
              canRaise: args.can_raise !== false,
            })
            return { action: d }
          } catch { return {} }
        })(),
        ...(() => {
          try {
            const mm = st.plan?.milestones?.[args.id]
            const stl = P.stalledOf(mm)
            const softBad = Boolean(stl) || Boolean(sp.mustStop)
            const g = P.hybridGate(mm, softBad)
            return { gate: g }
          } catch { return {} }
        })(),
        ...(() => {
          try {
            const cg = P.channelGate(st.plan, args.id)
            if (cg.exhausted) return { channel: { exhausted: true, boundary_seq: cg.boundary_seq, hint: cg.hint } }
            if (cg.blocked) return { channel: { blocked: true, why: cg.why, hint: cg.hint } }
            return {}
          } catch { return {} }
        })(),
        ...(sp.mustStop ? { spin: { report: sp.report, escape: sp.escape } } : {}),
        ...(jury && jury.overreached
          ? { overreach: '⚠️ 这一庭的「缺什么」**过半是新增需求**（要求换命令/换参数/另跑一遍），'
            + '不构成「证据不足」。\n'
            + `  逐条类型：${(jury.missing || []).map((m, i) => `${i + 1}.${jury.missing_kind?.[i] === 'overreach' ? '越界' : '可补'}`).join(' ')}\n`
            + '  ⇒ **别改判据**（改成什么样都产不出那条命令的读数）。三条出口：'
            + '① 如果那条读数已由别的里程碑交付（同账本查：它可能已经 done），引用它；'
            + '② 如果确实要那条读数 ⇒ 它该是一条**新里程碑**，不是把这条判成 pending；'
            + '③ 如果这条命令就到此为止 ⇒ 把 claim 缩到这条命令能产出的范围。' }
          : {}),
        ...(jury && Array.isArray(jury.gaps) && jury.gaps.length
          ? { contradiction: `陪审看到 ${jury.gaps.length} 处**落差**（不是缺口）：\n`
            + jury.gaps.map((g, i) => `  ${i + 1}. ${g}`).join('\n') }
          : {}),
        ...(() => {
          if (r.status === 'done') return {}
          try {
            const atk = FAL.attack({ claim: String(m.text || ''), doneWhen: m.done_when || {}, kind: (m.done_when || {}).mode })
            if (!atk.ok || !atk.shots.length) return {}
            return {
              falsify: {
                claim: atk.claim,
                shots: atk.shots.slice(0, 4).map((x) => ({ angle: x.angle, try: x.try, ifHolds: x.ifHolds })),
                note: atk.note,
              },
            }
          } catch { return {} }
        })(),
        lights: P.planLights(st.plan, st.tree?.tasks, planSitFor(st)),
        note: r.status === 'done'
          ? `✅ 判据通过（${r.why}）。该任务交付进度 ${d.done}/${d.total}`
            + (jury && jury.decision === 'unavailable'
              ? '\n⚠️ 本条未经陪审复核（抓错能力未验证）——交付完成，但欠一次开庭。'
              : '')
            + (d.allGreen ? ' ⇒ **全部里程碑已绿**，按「交付物在哪、怎么验」收尾。' : '。')
          : `❌ 判据未过（${r.why}）⇒ 里程碑仍是 ${r.status}。`
            + (juryLineText ? `\n${juryLineText}` : '')
            + (jury && jury.decision === 'topped'
              ? '\n**证据到顶，不是"再补一件"**：缺的是外部才有的（权威基准/第三方复跑）。'
                + '别再改判据去迎合陪审（那是让判据变软），也别把 pending 说成 done。'
                + '正确出口：用 brain_terminate 声明「不可达」，missing 写明缺哪个外部条件。'
                + '（若交付面是实的、只是这一条自证不到顶，就如实写"代码完成、性质全过、机制未验、来源自证不可达"——这句话本身是合法的终止去向。）'
              : jury && jury.decision === 'unclear'
                ? '\n**这条不是补证据能解决的**：判据本身含糊 ⇒ 用 `brain_plan action:"put"` 改这条的 `done_when`，把它写成一句能判真假的话（改判据会让它回 pending 并留痕，那是应该的）。'
                : jury && jury.decision === 'unavailable'
                  ? '\n**陪审未开成庭** ⇒ 本条未经陪审复核（抓错能力未验证），但**交付不挡**。若已 done，抓错这条悬空，待开庭后补审。'
                  : '\n修到达标，或 brain_plan 改判据（改判据会回 pending 并留痕）。'
                    + '**重跑同一条命令不会改变陪审结论** —— 要补的是陪审指名的那一件。'),
        saved,
      }
    },
    presentCall: () => ({ card: 'generic', title: '外置大脑·跑判据', kind: 'other', rawInput: {} }),
  })

  reg({
    name: 'brain_escalate',
    description:
      '外置大脑·向上报告：**做不到**和**我需要这个**是两件事。'
      + '⭐ 三档里缺的那一档：硬顶（一直 verify）/ 辞职（dropped）/ **向上报告（这一档）**。'
      + '三样必填，缺一不可（少一样就变成抱怨，而不是「给我这个就能继续」）：'
      + '① what_i_need（要什么，**具体到对方能直接给**：一个 webhook / 一个人跑一次 / 一台外网机器）；'
      + '② why_i_cant（为什么自己搞不定，**具体到缺的是这个**，不是「做不到」）；'
      + '③ resume_from（拿到后从哪接 —— 少了它，资源到位了你也接不上）。'
      + '⚠️ 状态变 escalated，**不是 failed，也不是 dropped** —— 它在等资源，不是失败了。'
      + '⚠️ 和 brain_terminate 的区别：那个是「我确认了这个宇宙里没有」（要阻断证据），这个是「我需要一个东西」。'
      + '资源到位后，再调一次并填 resumed_by=谁给的，会把状态接回来。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '里程碑编号' },
        what_i_need: { type: 'string', description: '⭐ 要什么资源（具体到对方能直接给）' },
        why_i_cant: { type: 'string', description: '⭐ 为什么自己搞不定（具体到缺的是这个，≥6 字）' },
        resume_from: { type: 'string', description: '⭐ 拿到后从哪接（哪一步、哪个命令）' },
        resumed_by: { type: 'string', description: '（可选）资源已到位时填「是谁给的」—— 会把状态接回来' },
      },
      required: ['id'], additionalProperties: false,
    },
    output: jsonOutput(OPEN_OBJ),
    async execute(args) {
      if (!st.plan) return { ok: false, why: '还没有计划（先 brain_plan）' }
      if (args.resumed_by) {
        const r2 = ESC.resumeEscalation(st.plan, args.id, args.resumed_by)
        if (r2.ok) { try { saveState(scoped(), st) } catch { } }
        return r2
      }
      const r = ESC.escalate(st.plan, args.id, args)
      if (r.ok) {
        try { saveState(scoped(), st) } catch { }
        return { ...r, escalated_line: ESC.escalatedLine(st.plan) }
      }
      return r
    },
  })

  reg({
    name: 'brain_terminate',
    description:
      '外置大脑·终止声明：要收尾/结束工作前，先声明「向」走到哪了 —— 三选一：'
      + '达成（列可核事实：命令/URL/文件/截图）/ 不可达（指名缺哪个外部条件）/ 转移（向变了，新向是什么）。'
      + '这是终止的**声明入口**：不声明就收尾 = 未声明终止。'
      + '「向」只来自用户，机制不替你判向；只把你的声明交给陪审复核，判它真不真。',
    parameters: {
      type: 'object',
      properties: {
        way: { type: 'string', description: '向的去向，三选一：达成 / 不可达 / 转移' },
        proof: { type: 'array', items: { type: 'string' },
          description: '达成时：可核事实清单（命令/URL/文件/截图），至少一件能当场验的' },
        missing: { type: 'string', description: '不可达时（必填）：缺哪个外部条件' },
        new_direction: { type: 'string', description: '转移时（必填）：新向是什么（须由用户确认，你无权自定）' },
        scope: { type: 'string', description: '不可达时的层级：task（默认=整件）/ milestone（只对一条里程碑）。局部卡住用 milestone。' },
        milestone: { type: 'string', description: 'scope=milestone 时必填：要声明的那条里程碑 id（只接受 blocked / failed 的）' },
        owner: { type: 'string', description: '不可达时（任务级必填）：承接者 —— 谁能提供这个外部条件、怎么找他。少于 4 字视为没给。' },
        blocked_evidence: { type: 'string', description: '★不可达（**终局声明**：这件事办不到）必填：**阻断证据** —— '
          + '做过一次取证、它在缺这个条件时失败了，写清命令与失败输出（≥10 字）。\n'
          + '⚠️ 只是想**请用户做一件事**（重启一次 / 复跑一条命令 / 给凭证）**不要用这个工具**：'
          + '那不是不可达，用 `brain_task` 记一条依赖或直接在回复里说即可 —— 默认走最省的做法。' },
      },
      required: ['way'], additionalProperties: true,
    },
    output: jsonOutput(OPEN_OBJ),
    async execute(args) {
      const way = String(args.way || '')
      if (!['达成', '不可达', '转移'].includes(way)) {
        return { ok: false, why: 'way 取值三选一：达成 / 不可达 / 转移（其余拒收）。终止不是「账勾完」，是「向走到哪了」。', saved: false }
      }
      if (way === '不可达') {
        const chk = P.checkUnreachable(st.plan, args)
        if (!chk.ok) return { ok: false, why: chk.why, saved: false }
        if (chk.note) diag({ ...cfg, workDir }, `terminate-unreachable scope=${chk.scope} ${chk.milestone || ''} ${chk.owner || ''}`)
      }
      if (way === '转移' && !String(args.new_direction || '').trim()) {
        return { ok: false, why: '转移时要写明新向（new_direction）：向只来自用户，你写出来等用户确认，不替用户定。', saved: false }
      }
      const decl = {
        way,
        proof: Array.isArray(args.proof) ? args.proof.map(String) : (args.proof ? [String(args.proof)] : []),
        missing: String(args.missing || ''),
        new_direction: String(args.new_direction || ''),
        scope: String(args.scope || '') === 'milestone' ? 'milestone' : 'task',
        milestone: String(args.milestone || '') || null,
        owner: String(args.owner || ''),
        at: new Date().toISOString(),
      }
      const dAll = P.deliveryAll(st.plan, st.tree?.tasks)
      const open = Object.keys(dAll).filter((k) => dAll[k].hasPlan && (dAll[k].pending > 0 || dAll[k].blocked > 0))
      const openPending = Object.keys(dAll).filter((k) => dAll[k].hasPlan && dAll[k].pending > 0)
      const openBlocked = Object.keys(dAll).filter((k) => dAll[k].hasPlan && dAll[k].blocked > 0)
      if (way === '达成' && open.length) {
        const blockedNote = openBlocked.length
          ? '；其中 ' + openBlocked.join('、') + ' 是「证据到顶」（缺的是外部才有的），不是"还差着做"，接「不可达」'
          : ''
        return {
          ok: false, saved: false,
          why: '「达成」被拒：交付账还欠着 ' + open.join('、')
            + '（pending ' + openPending.length + ' / blocked ' + openBlocked.length + '）。'
            + '「达成」和「还欠着」不能同时成立 —— 出口三选一：'
            + '① 继续做完；② 用 brain_plan 把欠的明确处置（dropped/failed 并写 why）；'
            + '③ 改声明「不可达」并指名缺哪个外部条件（说不出来就是没做完）。' + blockedNote,
        }
      }
      if (way === '达成') {
        const doneN = Object.values(st.plan?.milestones || {}).filter((m) => m && m.status === 'done').length
        const openUnknown = Object.values(st.unknown?.items || {}).filter((u) => u && (u.state === 'raw' || u.state === 'classified'))
        const stopChk = TERR.canStop({
          delivery: { done: doneN },
          openItems: openUnknown.map((u) => ({ what: u.id, next: String(u.from || '').trim() })),
          unknownOver: false,
          budget: {
            byHuman: args.by_human === true,
            used: Number(st.tree?.spent || 0),
            total: Number(st.tree?.budget || 100),
          },
        })
        const covGap = (() => {
          const out = []
          for (const [mid, mm] of Object.entries(st.plan?.milestones || {})) {
            const last = (mm.evidence || []).slice(-1)[0]
            if (!last) continue
            if (Array.isArray(last.uncovered) && last.uncovered.length) {
              out.push({ mid, files: last.uncovered })
            }
          }
          return out
        })()
        if (covGap.length) {
          const lines = covGap.map((g) => `  · ${g.mid}：${g.files.slice(0, 5).join('、')}${g.files.length > 5 ? ` 等 ${g.files.length} 个` : ''}`)
          return {
            ok: false, saved: false,
            why: `「达成」被拒（**改了但没验**）：\n${lines.join('\n')}`
              + '\n  ⇒ 出口三条：① 给这些文件补一条判据并 verify；'
              + '② 说明它们与本任务无关（那就在判据命令里写清它验谁，让 covers 对上）；'
              + '③ 确实没改 —— 那说明快照抓错了，把判据命令改成带路径的形式。',
          }
        }

        if (!stopChk.c1 || !stopChk.c2) {
          return {
            ok: false, saved: false,
            why: `「达成」被拒（停的边界）：\n${stopChk.misses.join('\n')}`
              + `\n  ⇒ 出口：① 把交付物做成可核事实（一条 done 的里程碑）；`
              + `② 给未结的未知池条目写清"下次从哪接"（${openUnknown.map((u) => u.id).join('、') || '无'}）。`
              + '\n  （不是"累不累"的问题：累可以停，但要先把上面两条说清 —— 那是给下一个人的交接。）',
          }
        }
      }

      st.termination = Array.isArray(st.termination) ? st.termination : []
      st.termination.push(decl)
      const jr = await runTerminationJury(decl)
      st.termination[st.termination.length - 1].jury = jr.rec
      const saved = saveState(scoped(), st)
      const line = J.juryLine(jr.rec)
      diag({ ...cfg, workDir }, `terminate way=${way} jury=${jr.rec.decision} open=${open.length}`)
      return {
        ok: true, way, recorded: true,
        jury: { decision: jr.rec.decision, why: jr.rec.why, unanimous: jr.rec.unanimous },
        jury_line: line,
        open_delivery: open,
        note: (line ? line + '\n' : '')
          + (open.length
            ? `⚠️ 交付账还欠着：${open.join('、')}。你声明「${way}」——若是「不可达」，确认这些欠账是否一并不可达；若是「达成」，这些欠账与你的声明矛盾。`
            : '终止声明已记。'),
        saved,
      }
    },
    presentCall: () => ({ card: 'generic', title: '外置大脑·终止声明', kind: 'other', rawInput: {} }),
  })

  reg_disabled({
    name: 'brain_terms',
    description:
      '外置大脑·术语：查一个词的**定义 + 一条真实发生过的例子**（帮你意会，别把定义当教条）。'
      + 'action 三种：'
      + '`get`（查一个词：is 指什么 / not 不管什么 / falsify 什么会推翻它 / 例 一段真实历史）／'
      + '`list`（列出全部已登记术语）／'
      + '`redefine`（**重新取定义**：你意会到更准的意思时改它，带 why，旧定义进历史留痕）。'
      + '⭐ 定义是「意象」（可重新取），不是判据；例子是「历史」（已发生的事实），不是教条。'
      + '遇到复杂问题需要处理、需要更改时，可以重新取定义（升维）——但要说清为什么，'
      + '悄悄换口径会被拒（redefine 要求 why + 新 not 不能空）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'list', 'redefine'], description: '查一个 / 列全部 / 重新取定义' },
        term: { type: 'string', description: '[get/redefine] 术语名（如：升维、降维、取、边界、留空、代价、判据…）' },
        is: { type: 'string', description: '[redefine] 新定义：它指什么（一句话，拿具体例子能判是/不是）' },
        not: { type: 'string', description: '[redefine] 新边界：它不管什么（留空 = 沿用旧边界）' },
        falsify: { type: 'string', description: '[redefine] 什么证据会推翻这个新定义（留空 = 沿用旧 falsify）' },
        why: { type: 'string', description: '[redefine] ★为什么重新取定义（≥6 字，缺它会被拒）' },
      },
      required: ['action'], additionalProperties: true,
    },
    output: jsonOutput(OPEN_OBJ),
    async execute(args) {
      const action = String(args.action || 'list')
      if (action === 'list') {
        return {
          terms: Object.keys(TRM.TERMS),
          note: '用 `brain_terms action:get term:词` 查某一条的定义+例子。定义可重新取定义（`action:redefine` 带 why）。',
        }
      }
      const term = String(args.term || '').trim()
      if (action === 'get') {
        const r = TRM.lookup(term)
        if (!r) {
          return {
            ok: false, term,
            why: `术语「${term}」没登记 —— 用 action:list 看有哪些词。`,
            note: '查不到就留空（别编一个像样的定义填上）。',
          }
        }
        return {
          ok: true, ...r,
          note: '定义是意象（可重新取定义，`brain_terms action:redefine` 带 why）；例是历史（不改写）。',
        }
      }
      if (action === 'redefine') {
        const r = TRM.redefine(term, { is: args.is, not: args.not, falsify: args.falsify, why: args.why, at: new Date().toISOString() })
        if (!r.ok) {
          return {
            ok: false, term, why: r.why,
            note: '重新取定义被拒：要么补 why，要么别把边界改没（not / falsify 不能空），要么这不算一次真修改（和旧定义完全一样）。',
          }
        }
        const applied = TRM.lookup(term)
        st.terms_overrides = {
          ...(st.terms_overrides || {}),
          [term]: { is: applied.is, not: applied.not, falsify: applied.falsify, why: args.why, v: r.v, at: new Date().toISOString() },
        }
        const saved = saveState(scoped(), st)
        diag({ ...cfg, workDir }, `terms redefine ${term} v${r.v} saved=${saved ? 'ok' : 'fail'}`)
        return {
          ok: true, term, v: r.v, prev: r.prev, saved,
          note: `「${term}」已重新取定义为 v${r.v}，旧定义进历史留痕。`,
        }
      }
      return { ok: false, why: `未知 action「${action}」—— 三选一：get / list / redefine` }
    },
    presentCall: () => ({ card: 'generic', title: '外置大脑·术语', kind: 'other', rawInput: {} }),
  })

  reg_disabled({
    name: 'brain_question',
    description:
      '外置大脑·取子问题：记一个**为了让任务成立而取的矛盾**。'
      + '⭐ why 必填 —— 取的理由就是权重来源（问不出「为什么取它」就不该让它进树）。'
      + 'critical=true 表示它挡在任务成立的关键路径上（权重 ×2）。'
      + 'parent 挂任务（或另一子问题 ⇒ 派生）。权重不靠大模型打分，靠「层级 + 取的理由 + critical」。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '子问题编号，如 Q1' },
        parent: { type: 'string', description: '挂哪个任务/子问题（任务=用户的话层，子问题=取的矛盾层）' },
        text: { type: 'string', description: '子问题一句话' },
        why: { type: 'string', description: '★取的理由（必填）：它跟父节点什么关系、为什么现在必须取它' },
        critical: { type: 'boolean', description: '是否关键路径（×2 权重）' },
        weight: { type: 'number', description: '不给就自动分（分走父额度的余量的一半）。'
          + '给了就必须 ≤ 父额度余量，否则拒收 —— 取即下边界，分出去的不能比父还多' },
      },
      required: ['id', 'parent', 'why'], additionalProperties: true,
    },
    output: jsonOutput(OPEN_OBJ),
    async execute(args) {
      if (!st.tree) st.tree = T.newTree()
      const parent = String(args.parent)
      const isDerive = st.tree.questions[parent] !== undefined
      const opt = { id: args.id, parent, text: args.text, why: args.why,
        critical: !!args.critical, weight: args.weight,
        seq: st.matrix?.seq ?? null }
      const r = isDerive ? T.deriveQuestion(st.tree, opt) : T.takeQuestion(st.tree, opt)
      const saved = saveState(scoped(), st)
      diag({ ...cfg, workDir }, `question ${args.id} ok=${r.ok} parent=${parent} weight=${r.weight ?? '-'}`)
      const peers = Object.values(st.tree.questions || {}).filter((q) => q.parent === parent && q.id !== String(args.id))
      let explored = ''
      if (peers.length) {
        explored = '\n【这个方向已有人走过（同父 ' + parent + ' 下，含证据家底）】\n'
          + peers.map((q) => `  - ${q.id}（权重 ${q.weight}）${q.text || ''}${T.evTag(q)}`).join('\n')
          + '\n  → 怀疑它就 brain_observe direction:"challenge" 找反证；顺着走就 support / precedent（先例，别人验证过的借来用）。'
      } else {
        explored = '\n【这个方向还没有人走过】—— 你是第一个，取就是了（不必查重）。'
      }
      return {
        ok: r.ok, id: args.id, weight: r.weight, parent,
        pressure: r.pressure ?? T.pressure(st.tree, parent),
        lights: T.treeLights(st.tree),
        note: r.ok
          ? `子问题已取，权重 ${r.weight}（从 ${parent} 的额度里分出来的；深一层就轻一半）。${explored}`
          : r.why,
        saved,
      }
    },
    presentCall: () => ({ card: 'generic', title: '外置大脑·取子问题', kind: 'other', rawInput: {} }),
  })

  reg_disabled({
    name: 'brain_back',
    description:
      '外置大脑·退回节点（回到空）：取错了就退。判「执」不是「取」、或证据推翻 ⇒ 调它。'
      + '该节点 + 全部子孙失效（**证据不灭**，只标记失效），父节点标「需重取」，记退回日志。'
      + 'reason 必填（为什么退回）—— 否则「回到空」不可复核。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '要退回的节点（任务或子问题）' },
        reason: { type: 'string', description: '★为什么退回（必填）：判据说这是执/证据推翻…' },
      },
      required: ['id', 'reason'], additionalProperties: true,
    },
    output: jsonOutput(OPEN_OBJ),
    async execute(args) {
      if (!st.tree) st.tree = T.newTree()
      const r = T.backToNode(st.tree, args.id, args.reason)
      const saved = saveState(scoped(), st)
      diag({ ...cfg, workDir }, `back ${args.id} ok=${r.ok} invalidated=${(r.invalidated || []).join(',')}`)
      return {
        ok: r.ok, id: args.id,
        invalidated: r.invalidated ?? null, parent: r.parent ?? null,
        lights: T.treeLights(st.tree),
        note: r.ok ? `已退回，父节点 ${r.parent || '（根）'} 标「需重取」—— 回到空，重新取。` : (r.why ?? '（该工具未给出原因。）'),
        saved,
      }
    },
    presentCall: () => ({ card: 'generic', title: '外置大脑·退回节点', kind: 'other', rawInput: {} }),
  })

  reg({
    name: 'brain_dissolve',
    description:
      '外置大脑·升维回执（矛盾消失）：升维之后，回答**被解决的那个主矛盾现在怎么样了**。'
      + '三态：dissolved（消失 ⇒ 该节点+全部子孙一并失去理由，父节点回到空重新取）／'
      + 'transformed（转移矛盾 ⇒ 必须给 to 去向，否则矛盾只是换位置、终将反弹）／'
      + 'still（原样还在 ⇒ **这次升维是执**：新变量没进这条矛盾的判据，`new_vars ∩ vars(C)=∅`）。'
      + '⚠️ 与已下线的 brain_back 的区别（历史对比）：back=取错了（错，所以废）；dissolve=父矛盾没了（**不错，是不必存在了**）。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '被升维解决的那个父矛盾节点 id（主节点）' },
        verdict: { type: 'string', enum: T.DISSOLVE_VERDICTS, description: '三态之一（给不出就不算回执）' },
        note: { type: 'string', description: '为什么这么判（可复核）' },
        to: { type: 'string', description: 'verdict=transformed 时必填：矛盾变成什么/去了哪一层' },
      },
      required: ['id', 'verdict'], additionalProperties: true,
    },
    output: jsonOutput(OPEN_OBJ),
    async execute(args) {
      if (!st.tree) st.tree = T.newTree()
      const isContraNode = Boolean(st.contra?.nodes?.[String(args.id || '')])
      const r = isContraNode
        ? CN.dissolveNode(st.contra, args.id, {
          verdict: args.verdict, note: args.note, to: args.to || null,
        })
        : T.dissolveSubtree(st.tree, args.id, {
          verdict: args.verdict, note: args.note, to: args.to || null,
        })
      if (r.ok) clearLiftPending(st, args.id, r)
      const saved = saveState(scoped(), st)
      diag({ ...cfg, workDir }, `dissolve ${args.id} ${isContraNode ? 'contra' : 'tree'} verdict=${args.verdict} ok=${r.ok} invalidated=${(r.invalidated || []).length}`)
      return {
        ok: r.ok, id: r.id ?? args.id,
        verdict: r.verdict ?? null, to: r.to ?? null,
        lostReason: r.invalidated ?? null, parent: r.parent ?? null,
        liftPending: (st.lift_pending || []).map((p) => p.rid),
        lights: T.treeLights(st.tree),
        note: r.ok
          ? (r.verdict === 'dissolved'
            ? `已消解：${(r.invalidated || []).length} 个节点失去理由（**证据不灭**），父节点 ${r.parent || '（根）'} 回到空重新取。`
            : (r.verdict === 'transformed'
              ? `已登记变形，去向 = ${r.to}。⚠️ 矛盾没消失，只是换了位置 —— 去向必须有人接手。`
              : '已登记「矛盾原样还在」⇒ 红灯：**这次升维是执**（新变量没进这条矛盾的判据）。'))
          : (r.why ?? '（该工具未给出原因。）'),
        saved,
      }
    },
    presentCall: () => ({ card: 'generic', title: '外置大脑·矛盾消失', kind: 'other', rawInput: {} }),
  })

  reg({
    name: 'brain_boundary',
    description:
      '外置大脑·机制自身的边界（自指）：查看或登记「机制自己撞过的墙」。'
      + '⚠️ 边界不该由机制自己想（构造器看不见自己），只能由**撞墙**长出来 —— '
      + '所以登记时必须给 why=撞了什么墙（事故/异常/被拒的证据）。'
      + '不给 text 时只列清单。（退回入口 brain_back 已于 2026-10-19 下线。）',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '边界一句话（不给 ⇒ 只列已有边界）' },
        why: { type: 'string', description: '★撞了什么墙（给 text 时必填）：事故经过/异常现象/被拒的证据' },
        kind: { type: 'string', description: '信号类别（决定节点 id = B-<kind>；同类别只留一个节点）' },
        critical: { type: 'boolean', description: '是否挡在关键路径上（×2 权重）' },
      },
      required: [], additionalProperties: true,
    },
    output: jsonOutput(OPEN_OBJ),
    async execute(args) {
      if (!st.tree) st.tree = T.newTree()
      const before = T.metaQuestions(st.tree).map((q) => ({ id: q.id, text: q.text, why: q.why, weight: q.weight }))
      if (!args?.text) {
        return {
          ok: true, mode: 'list', meta: T.META_ID, count: before.length, boundaries: before,
          note: before.length
            ? '机制自身已取的边界（撞墙长出来的）。加压/封锁前先自查。（退回入口 brain_back 已于 2026-10-19 下线。）'
            : '还没有边界 —— 说明**还没撞过墙**（不是「没有边界」，是「还没被发现」）。',
        }
      }
      if (!args.why) return { ok: false, note: '登记边界必须给 why —— 没撞墙不能说边界（想出来的边界 = 执，会漂）' }
      const r = absorbBoundary(st, cfg, {
        kind: args.kind || String(args.text).slice(0, 12), text: args.text, why: args.why, critical: !!args.critical,
      })
      const saved = saveState(scoped(), st)
      diag({ ...cfg, workDir }, `boundary kind=${args.kind || '-'} ok=${r.ok}`)
      return {
        ok: r.ok, mode: 'register', id: r.id, saved,
        boundaries: T.metaQuestions(st.tree).map((q) => ({ id: q.id, text: q.text, weight: q.weight })),
        lights: T.treeLights(st.tree),
        note: r.ok ? `已取下边界 ${r.id}（挂在 META 下）。` : r.why,
      }
    },
    presentCall: () => ({ card: 'generic', title: '外置大脑·机制边界', kind: 'other', rawInput: {} }),
  })

  reg({
    name: 'brain_contra',
    description:
      '外置大脑·矛盾树（层级轴）。**主矛盾只有一条**（我与目标之间）—— 出口：这句只管矛盾树，'
      + '交付账侧多条任务并列是合法的（真机 4 条，90+100+100+100）。'
      + '任务 > 1 条且没声明 conflicts ⇒ 只报「这几条在抢同一个总量吗」，不判违规。'
      + '它不可解，只能转移或者共存 —— 反证：若某天它真被解决了，说明当初把它当主矛盾就是错的。'
      + '每条子矛盾必须指出是哪次「取」的哪条假设把它推走的（无出处不收）；'
      + '在本层至少试过两种手法（含本类默认手法）都无果，才准 op:"climb" 回到上一层重取；'
      + '重取必须换边界、加变量、给判据与预测 —— 否则判「执」。'
      + '\nact:"知止"（停手）必须当场付清三件套 what_left / stop_at / fire_when，'
      + '并自动转成一条隐患账 —— 取到合适就不取=知止，但"合适"是一次取，下了边界就要说清边界外是什么。'
      + '\n另外五种手法各自欠一项产物（2026-10-18）：补观测欠 observed+where（看到了什么/在哪看的）；'
      + '复核欠 rerun+diff（重跑了什么/差在哪）；降维欠 split+why_orthogonal（拆成哪几块/为什么不重叠）；'
      + '取舍欠 yield_to+cost（让给谁/代价是什么）；升维走 brain_lift_check 的 way+source（用哪招/借自谁）。'
      + '欠着**不拒收**，代价是换不来 op:"climb" 的资格 —— "我试过了"不构成试过，'
      + '（补这条的由来：此前只给"知止"留了账，另外五种都空着 ⇒ 那不是设计，是漏。'
      + '现在逐条补齐，口径记在 contradiction.mjs 的 ACT_OWES，改它以那里的版本为准，'
      + '否则同一条欠项在两处会算出两种答案。）'
      + '\nop：view 看地形 / observe 建主矛盾 / child 开子矛盾 / try 试一手 / climb 上爬 / fake 判伪 / coexist 共存。',
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['view', 'observe', 'child', 'try', 'climb', 'fake', 'coexist'] },
        id: { type: 'string', description: '矛盾编号（C0 主矛盾 / C1… 子矛盾）' },
        parent: { type: 'string', description: 'child 时必填：挂到哪条矛盾下' },
        a: { type: 'string', description: '★矛盾的一端 = **路径 A**：走这条路会得到什么结果（不是"现状"，是"这条路的结果"）' },
        b: { type: 'string', description: '★矛盾的另一端 = **路径 B**：走另一条路会得到什么结果（不是"目标"，是"另一条路的结果"）' },
        destination: { type: 'string', description: '★两条路径**共同的终点**（同一个东西，例如"用户知道该不该信这个收益"）。'
          + '填不出共同终点 ⇒ 那不是矛盾，是**欠账**（缺口）—— 改用 brain_plan 建成里程碑。'
          + '判据：这格不能是 a 或 b 的原文，得是两者都要抵达的同一个点（做不到时，就说明这其实是欠账）。' },
        statement: { type: 'string', description: '一句话说清这条矛盾是什么（两端在哪对不上）' },
        kind: { type: 'string', description: '七类之一：名实不符/开环/口径/欠账/单例/幂等/瞬态' },
        observed: { type: 'string', description: '★观察在前（必填）：在哪个事实上看到了这条矛盾' },
        p: { type: 'number', description: '这条矛盾成立的可能性 0..1（不是"我有多想解决它"）' },
        from_belief: { type: 'string', description: '★哪条信念（beliefs 的 id）' },
        from_assumption: { type: 'string', description: '★那条信念的哪条假设把矛盾推到了这里' },
        model_vars: { type: 'array', items: { type: 'string' }, description: '新模型引入的变量（重取时必须有旧模型没有的）' },
        model_boundary: { type: 'string', description: '新模型的边界（做的这次定义）' },
        model_criterion: { type: 'string', description: '新模型下"什么算解决"的可执行判据' },
        model_predict: { type: 'string', description: '新模型的第一个可证伪预测' },
        act: { type: 'string', description: '十种手法之一（2026-10-21 从六种扩到十种）：补观测/复核/降维/升维/知止/取舍/重定义/转移/取无/平衡' },
        why: { type: 'string', description: '凭什么这么判/这么试（必填）' },
        evidence: { type: 'string', description: 'try resolved=true 时必填：怎么验的、在哪能看到' },
        resolved: { type: 'boolean', description: '这一手是否真的解掉了（没有 evidence 不收）' },
        what_left: { type: 'string', description: '★act=知止 必填：保留下来的是哪条矛盾（不许写"无"）' },
        stop_at: { type: 'string', description: '★act=知止 必填：停在哪个边界上 —— 这个"够了"在什么范围内成立' },
        fire_when: { type: 'string', description: '★act=知止 必填：什么条件下必须回来（边界失效的判据）' },
        was: { type: 'string', description: '★act=重定义 必填：原来把它当什么问题（旧定义）' },
        now: { type: 'string', description: '★act=重定义 必填：现在把它当什么问题（新定义，不能与 was 相同）' },
        where: { type: 'string', description: 'act=补观测：在哪看的（路径/命令/URL）。配 observed 一起交' },
        rerun: { type: 'string', description: 'act=复核：重跑了什么（命令/输入/环境/版本）' },
        diff: { type: 'string', description: 'act=复核：跟上次差在哪（没差也要写"没差"——否则等于只跑了一遍）' },
        split: { type: 'string', description: 'act=降维：拆成哪几块，各自管什么（只拆子任务不算降维）' },
        why_orthogonal: { type: 'string', description: 'act=降维：为什么这几块不重叠、边界在哪不打架' },
        yield_to: { type: 'string', description: 'act=取舍：让给哪一条（不让就不是取舍，是两边都要）' },
        transfer_to: { type: 'string', description: 'act=转移：矛盾挪到哪（承接者要具名，否则它只是"没人管"的另一种说法）' },
        rebound_when: { type: 'string', description: 'act=转移：什么条件下会反弹回来（= 这条矛盾在外面过期的判据）' },
        void_from: { type: 'string', description: 'act=取无：从「无」的哪里取（当前变量集之外的那一段，具体指出来）' },
        new_contra: { type: 'string', description: 'act=取无：新变量自己带来的新矛盾（没有 ≈ 0 的评估，就不是对冲，是换了个东西）' },
        balance_point: { type: 'string', description: 'act=平衡：平衡点在哪（双方力量调到什么比例算共存）' },
        monitor: { type: 'string', description: 'act=平衡：谁持续监测它（平衡是会破的，没人看着就等于没做）' },
        recheck_when: { type: 'string', description: 'climb 后 parked 的复查条件（什么时候回来再看）' },
        n_contra: { type: 'number', description: 'fake 时的独立反证票数（≥2 才判伪）' },
        cost: { type: 'string', description: 'coexist 必填（共存要付什么代价）；act=取舍 也用它（让出的那份代价是什么）' },
        until: { type: 'string', description: 'coexist 必填：共存到什么时候，到期必须重判' },
      },
      required: ['op'], additionalProperties: true,
    },
    output: jsonOutput(OPEN_OBJ),
    async execute(args) {
      if (!st.contra) st.contra = CN.newContradictionTree()
      const op = String(args?.op || 'view')
      const view = () => ({
        tree: CN.renderContra(st.contra, 12, st.ob),
        summary: CN.contraSummary(st.contra),
        obligation: { retired: true, note: '义务账已退役（2026-10-19）：零入口且与四处状态重复，见 INSTITUTIONS B11' },
      })
      const done = (r) => {
        const saved = r?.ok ? saveState(scoped(), st) : 'SKIPPED（被拒，未写盘）'
        return { ok: !!r?.ok, op, ...r, saved, ...(r?.ok ? view() : {}) }
      }

      if (op === 'view') return { ok: true, op, ...view() }

      if (op === 'observe') {
        const r = CN.observeMain(st.contra, {
          a: args.a, b: args.b, statement: args.statement, kind: args.kind,
          observed: args.observed, p: args.p,
        })
        if (r.ok) {
          diag({ ...cfg, workDir }, `contra L0 ${args.kind || '-'}`)
          try {
            const items = Array.isArray(st.mustAnswer?.items) ? st.mustAnswer.items : []
            const kept = items.filter((it) => !(it && it.kind === 'contra'
              && String(it.text || '').includes('还没有主矛盾')))
            if (kept.length !== items.length) {
              st.mustAnswer.items = kept
              diag({ ...cfg, workDir }, `mustAnswer drop stale contra item (${items.length}->${kept.length})`)
            }
          } catch (e) { }
        }
        return done(r)
      }

      if (op === 'child') {
        const model = args.model_boundary
          ? { vars: args.model_vars || [], boundary: args.model_boundary,
            criterion: args.model_criterion || '', predict: args.model_predict || '' }
          : null
        const r = CN.openChild(st.contra, String(args.parent || st.contra.root || ''), {
          statement: args.statement, between: { a: args.a, b: args.b }, kind: args.kind,
          observed: args.observed, p: args.p, weight: args.weight, model,
          from: { belief_id: args.from_belief, assumption: args.from_assumption },
          ob: st.ob, opened_seq: Number(st?.matrix?.seq) || null,
        })
        if (r.ok) diag({ ...cfg, workDir }, `contra ${r.id} L${r.node.level} kind=${args.kind || '-'}`)
        return done(r)
      }

      if (op === 'try') {
        const r = CN.trySolve(st.contra, String(args.id || ''), {
          act: args.act, why: args.why, evidence: args.evidence, resolved: args.resolved,
          what_left: args.what_left, stop_at: args.stop_at, fire_when: args.fire_when,
          observed: args.observed, where: args.where,
          rerun: args.rerun, diff: args.diff,
          split: args.split, why_orthogonal: args.why_orthogonal,
          yield_to: args.yield_to, cost: args.cost,
          was: args.was, now: args.now,
          transfer_to: args.transfer_to, rebound_when: args.rebound_when,
          void_from: args.void_from, new_contra: args.new_contra,
          balance_point: args.balance_point, monitor: args.monitor,
          ob: st.ob, closed_seq: Number(st?.matrix?.seq) || null,
        })
        if (r.ok && r.hazard) {
          if (!st.hazards) st.hazards = BL.newHazardStore()
          const hz = BL.openHazard(st.hazards, r.hazard)
          r.hazard_id = hz.id
          r.why += `（隐患 ${hz.id} 已自动记账）`
          diag({ ...cfg, workDir }, `contra ${args.id} 知止 → 隐患 ${hz.id}`)
        }
        return done(r)
      }

      if (op === 'climb') {
        const r = CN.climb(st.contra, String(args.id || ''), {
          why: args.why, recheck_when: args.recheck_when,
          ob: st.ob, closed_seq: Number(st?.matrix?.seq) || null,
          opened_seq: Number(st?.matrix?.seq) || null,
        })
        if (r.ok) diag({ ...cfg, workDir },
          `contra climb ${r.id} → ${r.back_to}（销 ${r.obVoided || 0} 条取证义务，父层新开 ${r.obRetake || '-'}）`)
        return done(r)
      }

      if (op === 'fake') {
        return done(CN.markFake(st.contra, String(args.id || ''), {
          p: args.p, n_contra: args.n_contra, why: args.why,
          ob: st.ob, closed_seq: Number(st?.matrix?.seq) || null,
        }))
      }

      if (op === 'coexist') {
        const r = CN.coexist(st.contra, String(args.id || st.contra.root || ''), {
          cost: args.cost, until: args.until,
        })
        if (r.ok && r.hazard) {
          if (!st.hazards) st.hazards = BL.newHazardStore()
          const hz = BL.openHazard(st.hazards, r.hazard)
          r.hazard_id = hz.id
          r.why += `（隐患 ${hz.id} 已自动记账：L0 永久欠账）`
        }
        return done(r)
      }

      return { ok: false, note: `未知 op：${op}` }
    },
    presentCall: () => ({ card: 'generic', title: '外置大脑·矛盾树', kind: 'other', rawInput: {} }),
  })

  if (cfg.guide && typeof ctx.on === 'function') {
    const injectedTurns = new WeakMap()
    const contraSig = new WeakMap()
    ctx.on('agent/pre-step', async ({ agent, messages, signal, step, turn }, next) => {
      const decision = await next()
      try {
        if (decision?.kind === 'reject' || signal?.aborted === true) return decision ?? {}
        if (!agent) return decision ?? {}
        if (!isChildSession(agent)) lastAgent = agent

        if (isChildSession(agent)) {
          const ck = engageKey(agent)
          if (ck && !childSeen.has(ck)) {
            childSeen.add(ck)
            diag({ ...cfg, workDir },
              `child skip turn=${turn ?? 0} sid=${ck} owner=${ownerSid(agent) || '-'}`
              + `（子会话不建树/不注入；其 brain_* 归属父会话）`)
          }
          return decision ?? {}
        }

        const intent = engageIntent(lastUserText(messages))
        const ek = ownerSid(agent)
        if (!ek) return decision ?? {}

        let restoreLine = null
        if (!engaged.has(ek) && !restoreTried.has(ek)) {
          restoreTried.add(ek)
          const flag = readEngageFlag(agent)
          if (flag) {
            engaged.add(ek)
            const since = flag.at ? String(flag.at).replace('T', ' ').slice(0, 19) : '未知时间'
            restoreLine = `【外置大脑 · 已按会话恢复】本会话上次开着机制（盘上记于 ${since}），`
              + '宿主重启后已自动恢复 —— 不必再说「开机制」。'
            diag({ ...cfg, workDir },
              `engage RESTORE turn=${turn ?? 0} sid=${ek} since=${flag.at || '-'}（盘上记着开着 ⇒ 已恢复）`)
          }
        }

        if (intent === 'off') {
          if (engaged.delete(ek)) {
            diag({ ...cfg, workDir }, `engage OFF turn=${turn ?? 0}（本会话转入静默）`)
            ctx.logger?.info(`${name}: 本会话退场（turn ${turn ?? 0}）`)
            persistEngage(agent, false)
          }
        } else if (intent === 'on') {
          if (!engaged.has(ek)) {
            engaged.add(ek)
            diag({ ...cfg, workDir }, `engage ON turn=${turn ?? 0}（本会话接管）`)
            ctx.logger?.info(`${name}: 本会话启用外置大脑（turn ${turn ?? 0}）`)
            persistEngage(agent, true)
          }
        } else if (intent === 'inherit') {
          if (!inherited.has(ek) && bindSession(agent)) {
            inherited.add(ek)
            const got = inheritLatest()
            if (got && !got.empty) {
              engaged.add(ek)
              saveState(scoped(), st)
              diag({ ...cfg, workDir },
                `inherit ON turn=${turn ?? 0} from=${got.from} pool=${got.pool} tasks=${got.tasks}`)
              ctx.logger?.info(`${name}: 接续历史任务线（池 ${got.pool} 条 / 账 ${got.tasks} 件）`)
            } else {
              diag({ ...cfg, workDir },
                `inherit MISS turn=${turn ?? 0}（本项目下没有可接的历史任务线 —— 本会话从空开始）`)
            }
          }
        }
        if (!engaged.has(ek)) {
          if (!silentSeen.has(ek)) {
            silentSeen.add(ek)
            diag({ ...cfg, workDir },
              `silent 本会话未启用（默认静默）turn=${turn ?? 0} —— 说「开机制」即接管`)
          }
          if (!engHintSeen.has(ek)) {
            const firstLine = String(lastUserText(messages) || '').split(/\r?\n/)[0].trim()
            const saysEngage = /开机制|接续|关机制/.test(firstLine)
            const tooLong = firstLine.length > 20
            if (saysEngage && tooLong) {
              engHintSeen.add(ek)
              const hint = `⚠️ 你这句（${firstLine.length} 字）里有口令，但口令**要单独发第一条、且 ≤20 字**；`
                + '揉进长句里机制读不到 ⇒ 本会话会一直静默（而且口令只取第一条，之后再补也没用）。'
                + '\n  ⇒ 补救：开一个新会话，**第一条只发「开机制」**，再接任务。'
              if (Array.isArray(decision.messages)) decision.messages.push(hint)
              diag({ ...cfg, workDir }, `engage HINT turn=${turn ?? 0} 口令揉进 ${firstLine.length} 字长句`)
            }
          }
          return decision ?? {}
        }

        if (!bindSession(agent)) return decision ?? {}
        {
          const lt = lastUserText(messages)
          if (lt) st.last_user_text = lt.length > 2000 ? lt.slice(0, 2000) : lt
        }
        {
          const nowMs = Date.now()
          const prevAt = Number(st.last_turn_at || 0)
          st.turn_sec = prevAt > 0 ? Math.round((nowMs - prevAt) / 1000) : null
          st.last_turn_at = nowMs
        }
        if (restoreLine) {
          if (pendingLoad && pendingLoad.scope === activeScope) {
            pendingLoad.line = `${pendingLoad.line}\n${restoreLine}`
            diag({ ...cfg, workDir },
              `engage RESTORE-NOTICE turn=${turn ?? 0} scope=${activeScope} via=load-receipt`)
          } else {
            ctx.logger?.info(`${name}: ${restoreLine}`)
            diag({ ...cfg, workDir },
              `engage RESTORE-NOTICE turn=${turn ?? 0} scope=${activeScope} via=logger`)
          }
          restoreLine = null
        }
        if ((step ?? 0) > 1) return decision ?? {}
        const t = turn ?? 0
        if (injectedTurns.get(agent) === t) return decision ?? {}

        let r = null
        if (cfg.autoEnforce) {
          r = enforce(st, { ...cfg, workDir }, `auto-${t}`)
          matrixRow(st, r, cfg, `auto-${t}`)
          saveState(scoped(), st)
          diag({ ...cfg, workDir }, `autoEnforce turn=${t} ops=${r.ops.length} changes=${r.changes.length}`)
          diag({ ...cfg, workDir }, `auto ${matrixLine(st.matrix, st.pool, t)}`)

          const sl = settleLifts(st, { ...cfg, workDir }, { turn: t })
          saveState(scoped(), st)
          diag({ ...cfg, workDir },
            `settleLifts turn=${t} still=${sl.still.length} take=${sl.take.length}`
            + ` noClaim=${sl.noClaim.length} stuck=${sl.stuck.length} ttl=${sl.ttl}`)
          if (sl.still.length) ctx.logger?.warn(`${name}: 自动判假（升维是执）${sl.still.join('、')}`)
          if (sl.stuck.length) ctx.logger?.warn(`${name}: 升维回执超期 ${sl.stuck.join('、')}（≥${sl.ttl} 轮）`)

          const dd = liveDebts(st, { ...cfg, workDir })
          diag({ ...cfg, workDir },
            `debts raw=${dd.raw} live=${dd.live.length} merged=${dd.merged.length}`
            + ` dissolved=${dd.dissolved.length} overflow=${dd.overflow.length} cap=${dd.cap}`)
        }

        if (stallStreak < 0) stallStreak = Number(st.stall_streak || 0)
        const T0 = tick()
        if (T0.last !== null) {
          if (T0.ticks === T0.last) stallStreak += 1
          else stallStreak = 0
        }
        T0.last = T0.ticks
        st.stall_streak = stallStreak
        st.brain_ticks = { ticks: T0.ticks, last: T0.last, at: new Date().toISOString() }

        if (stallStreak >= (cfg.stallLimit ?? 5)) {
          const ab = absorbBoundary(st, cfg, {
            kind: 'pressure-ignored',
            text: `硬指令连续 ${stallStreak} 轮零 brain_* 回应`,
            why: '机制加压无效 ⇒「逼它看见」这条干预本身有边界没展开（加压不是万能的）',
          })
          if (ab.ok) {
            saveState(scoped(), st)
            diag({ ...cfg, workDir }, `ABSORB ${ab.id} turn=${t} stall=${stallStreak}`)
            ctx.logger?.info(`${name}: 撞墙信号 → 取下边界 ${ab.id}`)
          }
        }

        const pending = (pendingLoad && pendingLoad.scope === activeScope) ? pendingLoad : null
        const loadNotice = pending ? pending.line : null
        const loadPhilosophy = pending ? (pending.philosophy || null) : null
        const phSame = pending ? !!pending.phSame : false
        const phPrev = pending ? pending.phPrev : null

        if (!cfg.hardGate) {
          if (typeof agent.inject === 'function') {
            const brief = renderBrief(st, scoped())
            const phAudit = loadPhilosophy ? refsAudit(loadPhilosophy) : null
            const phPart = loadPhilosophy
              ? `${phSame ? philosophySkipLine(loadPhilosophy, phPrev, phAudit) : philosophyBlock(loadPhilosophy, phAudit)}\n\n` : ''
            agent.inject(injectedMessage((loadNotice ? `${loadNotice}\n\n` : '') + phPart + brief))
            injectedTurns.set(agent, t)
            if (loadPhilosophy) {
              commitPhilosophyDelivery(st, loadPhilosophy, phSame)
              saveState(scoped(), st)
              diag({ ...cfg, workDir }, `philosophyInject turn=${t} mode=${phSame ? 'skip' : 'full'}`
                + ` chars=${loadPhilosophy.chars} sha=${loadPhilosophy.sha || '-'} ${refsDiag(phAudit)} via=inbox`)
              if (phAudit && !phAudit.ok) {
                diag({ ...cfg, workDir }, `refs GHOST turn=${t} ghost=${phAudit.ghost.join(',')}`
                  + ` from=${loadPhilosophy.file} —— 文档引用了不存在的工具，已在上下文里亮红`)
              }
            }
            const w = briefHasWork(st, { ...cfg, workDir })
            diag({ ...cfg, workDir }, `inject turn=${t} hasWork=${w.hasWork} chosen=${w.chosen} pending=${w.pending} bytes=${brief.length}`)
            ctx.logger?.info(`${name}: turn ${t} 注入分发清单`)
            if (pending) {
              pendingLoad = null
              diag({ ...cfg, workDir }, `loadNotice turn=${t} scope=${activeScope} via=inbox`)
            }
          }
          return decision ?? {}
        }

        const bgate = boundaryGuard({
          kind: 'pressure',
          target: 'agent',
          exits: ['brain_status', 'brain_enforce', 'brain_settle'],
          criterion: 'signal',
        })
        if (!bgate.ok) {
          absorbBoundary(st, cfg, {
            kind: `veto-${String(bgate.violated).split('·')[0].toLowerCase()}`,
            text: `边界闸拒发：${bgate.violated}`,
            why: bgate.reason,
          })
          saveState(scoped(), st)
          diag({ ...cfg, workDir }, `BOUNDARY VETO ${bgate.violated} turn=${t}`)
          ctx.logger?.warn(`${name}: 边界闸拦下本动作（${bgate.violated}）—— 不施加`)
          return decision ?? {}
        }

        const qg = quietGate(st, cfg, stallStreak)
        if (qg.on) diag({ ...cfg, workDir }, `quiet turn=${t} ${qg.why}`)

        const hd = hardDirective(st, cfg, stallStreak)
        const extra = []
        let ma = null
        try {
          ma = buildMustAnswerForRound(st)
          if (ma.items.length || ma.missed.length) {
            diag({ ...cfg, workDir }, mustAnswerTrace(ma, qg, t))
          }
          if (ma.items.length && !qg.on && Array.isArray(decision.messages)) {
            extra.push(hardNotice(mustAnswerLines(ma), '外置大脑·本轮必答'))
            injectedTurns.set(agent, t)
          }
          if (ma.missed.length) saveState(scoped(), st)
        } catch (error) {
          diag({ ...cfg, workDir }, `mustAnswer FAIL ${String(error)}`)
        }
        if (loadNotice) {
          extra.push(hardNotice([loadNotice]))
        }
        if (loadPhilosophy) {
          const phAudit = refsAudit(loadPhilosophy)
          extra.push(hardNotice(
            [phSame ? philosophySkipLine(loadPhilosophy, phPrev, phAudit) : philosophyBlock(loadPhilosophy, phAudit)],
            '外置大脑·哲学',
          ))
          if (phAudit && !phAudit.ok) {
            diag({ ...cfg, workDir }, `refs GHOST turn=${t} ghost=${phAudit.ghost.join(',')}`
              + ` from=${loadPhilosophy.file} —— 文档引用了不存在的工具，已在上下文里亮红`)
          }
        }
        try {
          if (!st.contra) st.contra = CN.newContradictionTree()
          const sig = `${st.contra.root || '-'}|${st.contra.seq}|${(st.contra.climbed || []).length}|${Object.keys(st.contra.nodes || {}).length}`
          if (contraSig.get(agent) !== sig && Array.isArray(decision.messages)) {
            contraSig.set(agent, sig)
            extra.push(hardNotice(CN.renderContra(st.contra, 12, st.ob), '外置大脑·矛盾树'))
            diag({ ...cfg, workDir }, `contraInject turn=${t} sig=${sig}`)
          }
        } catch (error) {
          diag({ ...cfg, workDir }, `contraInject FAIL ${String(error)}`)
        }
        if (hd.severity !== 'none' && Array.isArray(decision.messages) && !qg.on) {
          const head = hd.severity === 'ignored'
            ? [`【外置大脑 · 硬指令 · 必读】机制已连续 ${stallStreak} 轮下发、未被 brain_* 回应：`]
            : ['【外置大脑 · 硬指令 · 必读】']
          extra.push(hardNotice([...head, ...hd.lines]))
          injectedTurns.set(agent, t)
          diag({ ...cfg, workDir }, `hardInject turn=${t} severity=${hd.severity} stall=${stallStreak} lines=${hd.lines.length}`)
          ctx.logger?.info(`${name}: turn ${t} 硬指令追加进本步（${hd.severity}）`)
        }
        if (qg.on && Array.isArray(decision.messages) && ((ma?.items?.length || 0) > 0 || hd.severity !== 'none')) {
          const body = quietLines({ ma, hd, qg })
          extra.push(hardNotice(body, '外置大脑·降噪'))
          injectedTurns.set(agent, t)
          diag({ ...cfg, workDir },
            `quietInject turn=${t} chars=${body.join('\n').length} items=${ma?.items?.length || 0}`
            + ` hd=${hd.lines.length} severity=${hd.severity}`)
        }
        if (compactedAfter.has(ek) && Array.isArray(decision.messages)) {
          compactedAfter.delete(ek)
          const rd = resumeDirective(st.plan, st.tree?.tasks)
          if (rd) {
            extra.push(hardNotice(
              ['【外置大脑 · 压缩后补全】宿主刚压缩了会话历史（把旧消息蒸馏成摘要），'
                + '以下硬状态在盘上、不随压缩丢，重新对齐：', rd],
              '外置大脑·压缩补全',
            ))
            injectedTurns.set(agent, t)
            diag({ ...cfg, workDir }, `compactResume turn=${t} sid=${ek}`)
          } else {
            diag({ ...cfg, workDir }, `compactResume turn=${t} sid=${ek} — 无 pending（交付账已平，无需补全）`)
          }
        }
        if (extra.length && Array.isArray(decision.messages)) {
          if (loadPhilosophy) {
            commitPhilosophyDelivery(st, loadPhilosophy, phSame)
            saveState(scoped(), st)
            diag({ ...cfg, workDir },
              `philosophyInject turn=${t} mode=${phSame ? 'skip' : 'full'} chars=${loadPhilosophy.chars}`
              + ` sha=${loadPhilosophy.sha || '-'} ok=${loadPhilosophy.ok} ${refsDiag(refsAudit(loadPhilosophy))}`
              + ` from=${loadPhilosophy.file || '-'} via=messages`)
            ctx.logger?.info(`${name}: turn ${t} 哲学${phSame ? '未变（跳过重灌）' : '注入'}`
              + `（${loadPhilosophy.chars} 字符${loadPhilosophy.ok ? '' : ' · 正文缺失'}）`)
          }
          if (pending) {
            pendingLoad = null
            diag({ ...cfg, workDir }, `loadNotice turn=${t} scope=${activeScope} via=messages`)
          }
          return { ...decision, messages: [...decision.messages, ...extra] }
        }
        return decision ?? {}
      } catch (error) {
        diag({ ...cfg, workDir }, `preStep FAIL turn=${turn ?? 0} ${String(error && error.stack || error)}`)
        ctx.logger?.warn(`${name}: pre-step 处理失败：${String(error)}`)
        return decision ?? {}
      }
    }, { prepend: true })
    mark.hooks += 1
    ctx.logger?.info(`${name}: 硬闸已挂（agent/pre-step · prepend · hardGate=${cfg.hardGate} stallLimit=${cfg.stallLimit}）`)
  }

  if (typeof ctx.on === 'function') {
    ctx.on('session/event', (session, event) => {
      if (!session || !event) return
      const sid = session.id
      if (typeof sid !== 'string' || !sid) return
      const h = session.header
      if (h && (h.origin === 'subagent' || (typeof h.parentSession === 'string' && !!h.parentSession))) return
      if (event.type === 'compaction/start') {
        diag({ ...cfg, workDir }, `compaction START sid=${sid} seq=${event.seq ?? '-'}`)
      } else if (event.type === 'compaction/summary') {
        const sr = event.data?.shadowedRange
        compactedAfter.add(sid)
        diag({ ...cfg, workDir },
          `compaction SUMMARY sid=${sid} shadowed=${sr?.start ?? '-'}-${sr?.end ?? '-'}`
          + ` tokens=${event.data?.shadowedTokenCount ?? '-'} seq=${event.seq ?? '-'} —— 置「压缩后补全」`)
      } else if (event.type === 'compaction/end') {
        diag({ ...cfg, workDir }, `compaction END sid=${sid} seq=${event.seq ?? '-'}`)
      }
    })
    mark.hooks += 1
    ctx.logger?.info(`${name}: 压缩后补全闸已挂（session/event · compaction）`)
  }

  if (typeof ctx.on === 'function') {
    let steerCount = 0
    let steerFp = null
    ctx.on('agent/turn-stopping', async ({ agent, turn, signal }) => {
      try {
        if (!agent || signal?.aborted) return
        if (isChildSession(agent)) return
        const ek = ownerSid(agent)
        if (!ek || !engaged.has(ek)) return
        if (!bindSession(agent)) return
        {
          try {
            const msAll = Object.values(st.plan?.milestones || {})
            const latestMsAt = msAll.reduce((a, m) => Math.max(a, Date.parse(m.updated_at || '') || 0), 0)
            const staleM = latestMsAt ? Math.floor((Date.now() - latestMsAt) / 60000) : -1
            diag({ ...cfg, workDir },
              `turn-stop turn=${turn ?? 0} tasks=${Object.keys(st.tree?.tasks || {}).length}`
              + ` ms=${msAll.length} staleMin=${staleM}`
              + ` open=${(() => { try { const a = P.deliveryAll(st.plan, st.tree?.tasks); return Object.keys(a).filter((k) => a[k].hasPlan && a[k].pending > 0).join(',') || '-' } catch { return '?' } })()}`)
          } catch { }
        }
        {
          const hasTasks = Object.keys(st.tree?.tasks || {}).length > 0
          const msCount = Object.keys(st.plan?.milestones || {}).length
          if (hasTasks && msCount === 0) {
            let dirty = null
            try {
              let dir = workDir
              for (let i = 0; i < 6; i++) {
                if (existsSync(resolve(dir, '.git'))) break
                const up = dirname(dir)
                if (up === dir) break
                dir = up
              }
              for (const sub of readdirSync(workDir, { withFileTypes: true })) {
                if (!sub.isDirectory()) continue
                const d2 = resolve(workDir, sub.name)
                if (existsSync(resolve(d2, '.git'))) { dir = d2; break }
              }
              const out = execSync('git status --porcelain', { cwd: dir, timeout: 15000, stdio: 'pipe', shell: true })
              dirty = String(out ?? '').split(/\r?\n/).filter(Boolean).length
            } catch { dirty = null }
            if (dirty && dirty > 0) {
              if (steerCount < 3) {
                steerCount++
                diag({ ...cfg, workDir },
                  `turn-steer NOACCOUNT turn=${turn ?? 0} tasks=${Object.keys(st.tree.tasks).length} ms=0 dirty=${dirty} count=${steerCount}`)
                ctx.logger?.warn(`${name}: 有 ${dirty} 个未提交改动，但**一个里程碑都没有** —— 续一轮让它建账（第 ${steerCount}/3 次）`)
                await agent.steer(
                  `⛔ 不许停（**改了但没建账**）：项目里有 ${dirty} 个未提交改动，但交付账上 0 个里程碑。`
                  + `\n  ⇒ 先 brain_task + brain_plan 把"你改了什么、怎么算成了"落成账，再 verify。`
                  + `\n  ⇒ 或者明确说"这些改动与本任务无关"（那也要写下来）。`
                  + `\n  （这是第 ${steerCount}/3 次提醒；第 3 次后放行并留痕，不无限耗。）`,
                )
                return
              }
              diag({ ...cfg, workDir }, `turn-steer NOACCOUNT-LIMIT turn=${turn ?? 0} dirty=${dirty} —— 放行（卡住），留痕待用户`)
              ctx.logger?.warn(`${name}: "改了但没建账" 连续 3 轮，放行（卡住），留痕待用户`)
            }
          }
        }

        {
          try {
            const hasTasks2 = Object.keys(st.tree?.tasks || {}).length > 0
            const msList = Object.values(st.plan?.milestones || {})
            if (hasTasks2 && msList.length > 0) {
              const latestMs = msList.reduce((a, m) => Math.max(a, Date.parse(m.updated_at || '') || 0), 0)
            const staleMin = latestMs ? Math.floor((Date.now() - latestMs) / 60000) : 9999
            if (staleMin >= 30) {
              let dirty2 = null
              try {
                let dir2 = workDir
                for (let i = 0; i < 6; i++) {
                  if (existsSync(resolve(dir2, '.git'))) break
                  const up = dirname(dir2)
                  if (up === dir2) break
                  dir2 = up
                }
                for (const sub of readdirSync(workDir, { withFileTypes: true })) {
                  if (!sub.isDirectory()) continue
                  const d3 = resolve(workDir, sub.name)
                  if (existsSync(resolve(d3, '.git'))) { dir2 = d3; break }
                }
                const out2 = execSync('git status --porcelain', { cwd: dir2, timeout: 15000, stdio: 'pipe', shell: true })
                dirty2 = String(out2 ?? '').split(/\r?\n/).filter(Boolean).length
              } catch { dirty2 = null }
              if (dirty2 && dirty2 > 0) {
                if (steerCount < 3) {
                  steerCount++
                  diag({ ...cfg, workDir },
                    `turn-steer STALEACCT turn=${turn ?? 0} ms=${msList.length} staleMin=${staleMin} dirty=${dirty2} count=${steerCount}`)
                  ctx.logger?.warn(`${name}: 账 ${staleMin} 分钟没动过，但项目里还有 ${dirty2} 个未提交改动 —— 续一轮让它交计划（第 ${steerCount}/3 次）`)
                  await agent.steer(
                    `⛔ 不许停（**改了活，但账不动**）：账上最新一条停在 ${staleMin} 分钟前，`
                    + `而项目里还有 ${dirty2} 个未提交改动。\n`
                    + '  ⇒ 你动手之前想过「这轮推进哪个子目标、怎么算成了」吗？\n'
                    + '  ⇒ **「修 bug / 顺带改一下 / 我觉得这里不对」—— 都算一个子目标，也要有 define + done_when。**\n'
                    + '     计划 = is（成什么样）/ not（不管什么）/ limit（何时不成立）+ done_when（怎么验）。\n'
                    + '  ⇒ 出口三条：① brain_plan 一条（带上面那四样）；'
                    + '② 写清「这些改动不属于任何子目标」（也要可核：文件/命令/退出码）；③ 承认做不完并说清差什么。\n'
                    + `  （第 ${steerCount}/3 次；第 3 次后放行并留痕，不无限耗。）`,
                  )
                  return
                }
                diag({ ...cfg, workDir }, `turn-steer STALEACCT-LIMIT turn=${turn ?? 0} staleMin=${staleMin} dirty=${dirty2} —— 放行（卡住），留痕待用户`)
                ctx.logger?.warn(`${name}: "改了活账不动" 连续 3 轮，放行（卡住），留痕待用户`)
              } else {
                diag({ ...cfg, workDir },
                  `turn-stop STALEACCT-SKIP turn=${turn ?? 0} staleMin=${staleMin} dirty=${dirty2 === null ? 'null' : dirty2}`)
              }
            }
          }
          } catch (e) {
            diag({ ...cfg, workDir }, `turn-stop STALEACCT-ERR turn=${turn ?? 0} ${String(e && e.message || e).slice(0, 140)}`)
          }
        }

        const dAll = P.deliveryAll(st.plan, st.tree?.tasks)
        const open = Object.keys(dAll).filter((k) => dAll[k].hasPlan && dAll[k].pending > 0)
        if (!open.length) { steerCount = 0; steerFp = null; return }
        const terms = Array.isArray(st.termination) ? st.termination : []
        const last = terms[terms.length - 1]
        if (last && last.scope !== 'milestone' && (last.way === '不可达' || last.way === '转移')) {
          const d = last.jury?.decision
          if (d !== 'fail' && d !== 'hung' && d !== 'unclear') {
            steerCount = 0; steerFp = null
            return
          }
        }
        const fp = open.join('|')
        if (fp !== steerFp) { steerFp = fp; steerCount = 0 }
        if (steerCount >= 3) {
          diag({ ...cfg, workDir },
            `turn-steer LIMIT turn=${turn ?? 0} open=${open.join('、')} count=${steerCount} —— 放行（卡住），留痕待用户`)
          ctx.logger?.warn(`${name}: 交付账 ${open.join('、')} 连续 ${steerCount} 轮续轮仍 pending，放行（卡住）`)
          return
        }
        steerCount++
        const rootP = T.pressure(st.tree, null)
        const overBudget = !!(rootP && rootP.left < 0)
        const base =
          '【外置大脑 · 对账闸】交付账还欠着：' + open.join('、')
          + '（pending）。「达成」与「还欠着」不能同时成立 —— 出口三选一（机制不替你选）：'
          + '① 继续做完；'
          + '② 收束：brain_plan 处置（dropped/failed + why）把没做完的降级成显式账、先把能交的落成 —— 逼近极限（预算/上下文/轮次）时这是正道，不是偷懒；'
          + '③ 改声明「不可达」并指名缺哪个外部条件（说不出来就是没做完）。'
        const termRejected = (last && (last.way === '不可达' || last.way === '转移') && last.jury)
          ? '\n⚠️ 你上次声明的「' + last.way + '」被陪审拒了（' + last.jury.decision + '：' + (last.jury.why || '') + '）'
            + '——它没认可，不算合法终止。'
            + (last.way === '不可达'
              ? '要么①继续做；要么先用 brain_verify 让陪审判「证据到顶」（缺的外部条件被点名、里程碑标 ⛔），再重新声明不可达。'
              : '要么①继续做；要么等用户确认新向（向只来自用户）。')
          : ''
        const hint = overBudget
          ? '\n（提示：根预算吃紧，任务合计 ' + rootP.used + ' > 根预算 ' + rootP.cap
            + '。预算不是死的 —— 可用 `brain_task root_budget:N` 申请提高总量并说明为什么值，'
            + '或给现在不做的任务降权回根。继续 / 申请 / 回根，你自己取，机制不替你选。）'
          : ''
        const text = base + termRejected + hint
        if (typeof agent.steer === 'function') {
          agent.steer({
            id: globalThis.crypto.randomUUID(),
            role: 'user',
            content: [{ type: 'text', text }],
            source: { kind: name },
          })
          diag({ ...cfg, workDir },
            `turn-steer turn=${turn ?? 0} open=${open.join('、')} count=${steerCount}`
            + (overBudget ? ` overBudget=${rootP.used}>${rootP.cap}` : '') + ' —— 对账续轮（续/收束/不可达三出口）')
          ctx.logger?.info(`${name}: turn ${turn ?? 0} 交付账欠 ${open.join('、')}，对账闸续轮（第 ${steerCount} 次，摆三出口${overBudget ? '，根预算超额 → 附提示' : ''}）`)
        } else {
          diag({ ...cfg, workDir },
            `turn-steer NOSTEER turn=${turn ?? 0} open=${open.join('、')} —— agent.steer 不可用，未续轮`)
        }
      } catch (error) {
        diag({ ...cfg, workDir }, `turn-stopping FAIL turn=${turn ?? 0} ${String(error && error.stack || error)}`)
      }
    })
    mark.hooks += 1
    ctx.logger?.info(`${name}: 对账闸已挂（agent/turn-stopping · 交付账 pending 摆三出口：续/收束/不可达 · 上限 3）`)
  }

  if (typeof ctx.on === 'function') {
    ctx.on('dispose', () => {
      const saved = []
      for (const [key, s] of statePool) saved.push(saveState({ ...cfg, workDir, scope: key }, s))
      ctx.logger?.info(`${name}: 卸载，${saved.length} 个项目大脑已落盘`)
    })
    mark.hooks += 1
  }

  const __toolN = REGISTERED_TOOLS.size
  ctx.logger?.info(
    (__toolN > 0
      ? `${name}: 就绪 —— ${__toolN} 个工具（${[...REGISTERED_TOOLS].join('/')}）`
      : `${name}: 就绪 —— 工具登记尚未完成（实际清单见 registeredTools()）`)
    + ` + ${cfg.guide ? '注入开' : '注入关'}` + `（自指：META 保留任务已入树）`,
  )
}

export default { name, inject, Config, apply }
