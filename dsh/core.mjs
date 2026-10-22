
import { matrixSummary } from './matrix.mjs'

export const NOISE_FLOOR_PP = 20.0
export const LR_ADMIT = 2.33

export const BAND_HI = 0.75
export const BAND_MID = 0.55
export const RETURN_BELOW = 0.40
export const OSC_WIN = 6
export const OSC_DEADZONE = 0.02
export const OSC_TURNS = 3
export const OSC_LO = 0.35
export const OSC_HI = 0.65
export const DEAD_TOP = 0.70
export const STALE_ROUNDS = 2
export const OBSERVED_MIN = 0.55

export const PRIOR_N = { 高: 2.5, 中: 1.0, 低: 0.0 }

export const UNKNOWN_WATERLINE = 10
export const UNKNOWN_RATE = 0.30

export const DONE_WHEN = {
  review: '重判后确信度回到地板以上，或显式写明『重判仍为低』并给出理由',
  split: '拆分出的最小子问题至少产生 1 条**观测类**新证据（判断类不算），且**能复跑**（给命令/URL/版本号，不是又一次自证）',
  observe: '至少产生 1 条**观测类**新证据（不是又一条判断）；来源必须在**本层之外**（别人的实现 / 官方文档 / 既有标准）或能原样复跑',
  lift: '新抽象层给出一个**可判定**命题，写明它在旧层为何不成立，且**至少带 1 条先例**'
    + '（evidenceClass:"precedent"：别人已验证的做法 + 你在本项目转写的判据 + 实测值）',
}

export const OP_ORDER = { RERUN: 0, LIFT: 1, EITHER: 1, SPLIT: 2, OBSERVE: 3 }
export const NID = { RERUN: 'V-{}', LIFT: 'L-{}', EITHER: 'L-{}', SPLIT: 'S-{}', OBSERVE: 'O-{}' }
export const KIND_OF = { RERUN: 'review', LIFT: 'lift', EITHER: 'lift', SPLIT: 'split', OBSERVE: 'observe' }

export const CAP = 3

export const CLUSTERABLE = {
  '⚠️ 从未观测': 'UNSEEN',
  '⚔️ 反证到达': 'CHAL',
}
export const CLUSTER_MIN = 5

export const BUDGET = { depth: 3, per_src: 4, open_debt: 8 }

export function confOf(n) {
  return 0.5 + 0.5 * Math.tanh(n / 2.0)
}

export function evaporate(e, ledger = 'ledger', decay = 0.35) {
  if (ledger === 'legacy') return 1.0
  return Math.pow(1.0 - decay, e.stale || 0)
}

export function confNow(e, ledger = 'ledger', decay = 0.35) {
  return 0.5 + (confOf(e.n) - 0.5) * evaporate(e, ledger, decay)
}

export function bandOf(conf) {
  return conf >= BAND_HI ? '高' : conf >= BAND_MID ? '中' : '低'
}
export const BAND_RANK = { 低: 0, 中: 1, 高: 2 }

export function turns(win, deadzone = OSC_DEADZONE) {
  const sig = []
  for (let i = 1; i < win.length; i++) {
    const d = win[i] - win[i - 1]
    if (Math.abs(d) >= deadzone) sig.push(d > 0 ? 1 : -1)
  }
  let n = 0
  for (let i = 1; i < sig.length; i++) if (sig[i] !== sig[i - 1]) n++
  return n
}

export function isOscillating(win) {
  if (win.length < 4) return false
  const mean = win.reduce((a, b) => a + b, 0) / win.length
  if (!(OSC_LO <= mean && mean <= OSC_HI)) return false
  return turns(win) >= OSC_TURNS
}

export function newPool() {
  return { ledger: 'ledger', rounds: [], entries: {}, rejected: [], signals: [] }
}

export function newEntry(cat, priorBand, extra = {}) {
  const n0 = PRIOR_N[priorBand] ?? 1.0
  return {
    cat,
    prior_band: priorBand,
    n: n0,
    hist: [confOf(n0)],
    accepted: 0,
    fake: 0,
    challenge: 0,
    chal_since_review: 0,
    stale: 0,
    log: [`init: 先验=${priorBand} ⇒ n=${n0.toFixed(2)}, conf=${confOf(n0).toFixed(3)}`],
    ...extra,
  }
}

export function addEvidence(pool, rid, o) {
  const e = pool.entries[rid]
  if (!e) return [false, `无此条目 ${rid}`]
  const { direction, strength, why } = o
  const exclusive = o.exclusive !== false

  if (o.evidenceClass === 'judg') {
    const msg = '拒收·判断类不是证据（LR≈1~2 < 准入地板 2.33） ⇒ 降级为『信号』：可记录，不动水位'
    e.log.push(`[降级] ${msg} :: ${why}`)
    pool.signals.push({ id: rid, why })
    return [false, msg]
  }
  if (!exclusive) {
    e.fake += 1
    const msg = '拒收·归属不互斥（同一证据被引作两边 ⇒ 伪矛盾信号，不是证据）'
    e.log.push(`[拒绝] ${msg} :: ${why}`)
    pool.rejected.push({ id: rid, why, reason: msg })
    return [false, msg]
  }
  if (o.lr !== undefined && o.lr !== null) {
    if (o.lr < LR_ADMIT) {
      const msg = `拒收·似然比 ${o.lr.toFixed(2)} < 准入地板 ${LR_ADMIT.toFixed(2)} ⇒ 推不动水位（判据与先验无关）`
      e.log.push(`[拒绝] ${msg} :: ${why}`)
      pool.rejected.push({ id: rid, why, reason: msg })
      return [false, msg]
    }
  } else if (o.evidencePp !== undefined && o.evidencePp !== null) {
    if (Math.abs(o.evidencePp) < NOISE_FLOOR_PP) {
      const msg = `拒收·量级 ${o.evidencePp}pp < 噪声地板 ${NOISE_FLOOR_PP}pp ⇒ 无法与噪声区分，不加水`
      e.log.push(`[拒绝] ${msg} :: ${why}`)
      pool.rejected.push({ id: rid, why, reason: msg })
      return [false, msg]
    }
  }

  const s = Math.max(0, Math.min(1, Number(strength)))
  const signed = direction === 'support' ? s : -s
  e.n += signed
  e.accepted += 1
  if (direction === 'challenge') {
    e.challenge += 1
    e.chal_since_review += 1
  }
  e.stale = 0
  const tag = direction === 'support' ? '支持' : '挑战'
  e.log.push(`[加水] ${tag} +${s.toFixed(2)}（pp=${o.evidencePp ?? 'n/a'}）:: ${why}`)
  return [true, `进水 ${tag} ${s.toFixed(2)}`]
}

export function beginRound(pool, label) {
  pool.rounds.push(label)
  for (const e of Object.values(pool.entries)) {
    e._acc0 = e.accepted
    e._ch0 = e.challenge
    if ((pool.ledger || 'ledger') === 'legacy') e.n *= 1.0 - (pool.decay ?? 0.35)
  }
  return pool
}

export function settle(pool, _label) {
  const ledger = pool.ledger || 'ledger'
  const decay = pool.decay ?? 0.35
  for (const e of Object.values(pool.entries)) {
    if (e.accepted === (e._acc0 ?? e.accepted)) e.stale = (e.stale || 0) + 1
    else e.stale = 0
    const c = confNow(e, ledger, decay)
    e.hist.push(c)
    e.band = bandOf(c)
    e.n_ev = e.n
  }
  return pool
}

export function markReviewed(e) {
  e.chal_since_review = 0
  e.chal_reviewed = (e.chal_reviewed || 0) + 1
}

export function triggers(e, roundLabel = null, ledger = 'ledger') {
  const out = []
  const conf = e.hist[e.hist.length - 1]
  const peak = e.hist.length ? Math.max(...e.hist) : 0.5
  const win = e.hist.slice(-OSC_WIN)
  const osc = isOscillating(win)

  if (conf < RETURN_BELOW && !osc) {
    out.push(['🔴 触发返回', `确信 ${conf.toFixed(3)} < ${RETURN_BELOW} ⇒ 退回 Q0~Q3 重判类别`])
    if (peak >= DEAD_TOP) {
      out.push(['↑ 升维候选',
        `曾达 ${peak.toFixed(3)} 后跌破 ${RETURN_BELOW} ⇒ 本层已判死。换抽象层问：原问题在新层还成立吗？`])
    }
  }
  if (osc) {
    const nt = turns(win)
    const mean = win.reduce((a, b) => a + b, 0) / win.length
    out.push(['⚫ 伪矛盾嫌疑',
      `窗口 ${win.length} 轮均值 ${mean.toFixed(2)}、转向 ${nt} 次 ⇒ 中间带持续来回、从不收敛，走 Q0 重审`])
    out.push(['↕ 振荡出口', '要么 ↑升维（这一层的取舍根本不存在）／要么 ↓降维（拆到取舍能落地的粒度）'])
  }

  const stale = e.stale || 0
  const acc = e.accepted || 0
  if (stale >= STALE_ROUNDS) {
    const never = ledger === 'ledger' ? acc === 0 : peak < OBSERVED_MIN
    if (never) {
      const src = acc === 0 && peak >= OBSERVED_MIN
        ? `（水位 ${conf.toFixed(3)} 全部来自**先验票**，未经任何检验）` : ''
      out.push(['⚠️ 从未观测',
        `峰值 ${peak.toFixed(3)}、已 ${stale} 轮零新证据，且**从未进水**${src}`
        + ` ⇒ 这不是'卡住'，是'从没碰过'。补一次观测即可（成本低）——别升维，也别降维`])
    } else if (RETURN_BELOW <= conf && conf < BAND_MID) {
      out.push(['↓ 降维候选',
        `曾达 ${peak.toFixed(3)} 的水位、现落到 ${conf.toFixed(3)}，且连续 ${stale} 轮零新证据 ⇒ `
        + `不是'平安'，是'水位在损失'。切一个**最小可达子问题**，让证据重新产生`])
    }
  }

  if (!osc && conf >= BAND_MID && stale >= STALE_ROUNDS * 2 && acc >= 1) {
    out.push(['↕ 方法用尽',
      `水位 ${conf.toFixed(3)} 还站得住，但已连续 ${stale} 轮零新证据（自证 ${acc} 次）⇒ `
      + '本层能给的变量用完了。换层：**先去看别人怎么解**（同类问题的成熟做法 / 官方文档 / 别人的实现），'
      + '把拿回来的**新变量**记成一条 obs —— 不是坐在原地想一个新命题'])
  }

  if (ledger === 'legacy') {
    const hasNew = (e.accepted || 0) > (e._acc0 ?? e.accepted ?? 0)
    if (hasNew && peak >= OBSERVED_MIN) {
      const bPeak = bandOf(peak), bCur = bandOf(conf)
      if (BAND_RANK[bCur] < BAND_RANK[bPeak]) {
        out.push(['📉 档位下滑',
          `本轮有新证据，但档位 ${bPeak} → ${bCur}（峰值 ${peak.toFixed(3)} → 现 ${conf.toFixed(3)}）`
          + ` ⇒ 判断被动摇，建议复核`])
      }
    }
  }

  let nChPending
  let head
  if (roundLabel === null || roundLabel === undefined) {
    nChPending = e.chal_since_review || 0
    head = `**累计 ${nChPending} 条挑战证据尚未复核**`
  } else {
    nChPending = (e.challenge || 0) - (e._ch0 ?? e.challenge ?? 0)
    head = `**本轮**采纳挑战证据 ${nChPending} 条`
  }
  if (nChPending > 0 && peak >= OBSERVED_MIN) {
    out.push(['⚔️ 反证到达',
      `${head}（累计采纳 ${e.challenge || 0} 条）⇒ 判断收到反证，建议复核。`
      + `当前 ${conf.toFixed(3)}（证据面 ${confOf(e.n).toFixed(3)}）`])
  }

  if (e.fake) out.push(['⚫ 伪矛盾信号', `归属不互斥证据 ${e.fake} 次`])
  return out
}

export function classify(e, tags) {
  const t0 = tags.map(([t]) => t)
  const has = (p) => t0.some((t) => t.startsWith(p))
  const nAccepted = e.accepted || 0

  if ((e.fake || 0) > 0 && t0.length === 0) {
    return ['假矛盾', `归属不互斥 ×${e.fake}（同一证据被引作两边）`, '消解，不动作']
  }
  if (has('⚠️ 从未观测')) {
    return ['暂时矛盾', '从未进水（accepted=0）⇒ 条件未到（缺观测/缺量级）', '先补观测']
  }
  if (has('🔴 触发返回') && !has('↑ 升维候选')) {
    return ['真矛盾', '本层判死（曾到高位后跌破）且**给不出上位解**（无升维候选）', '走分：取舍＋记代价']
  }
  if (has('↑ 升维候选') || has('↕ 振荡出口') || has('↕ 方法用尽')) {
    return ['可合矛盾', '存在上位目标（升维）或更细粒度（降维）可同时满足', '**先走合**']
  }
  if (has('↓ 降维候选')) {
    return ['可合矛盾', '可拆到更细粒度分别满足', '**先走合**·降维']
  }
  if (has('📉 档位下滑') || has('⚔️ 反证到达')) {
    return ['平衡矛盾', `收到反证但未判死（累计挑战 ${e.challenge || 0} 条）`, '先复核（Q0~Q3 重判类别）']
  }
  if (t0.length > 0) {
    return ['未定矛盾', `有信号（${t0.join('、')}）但六类判据全不匹配 ⇒ **判据表有洞**（分类器欠账）`,
      '入未知池 + 记分类器欠账：须补规则，**不许静默 absorbed**']
  }
  if (nAccepted > 0) {
    return ['平衡矛盾', `零对立信号、但**曾被采纳 ${nAccepted} 次** ⇒ 参与过决策且未起冲突`,
      '接受共存（接受次要矛盾存在），登记不动作']
  }
  return ['未定矛盾', '零对立信号 × **从未被采纳** ⇒ 说不出这是什么矛盾（回到未分状态）',
    '入未知池（raw 保留），不动作、不占额度，等人工重取']
}

export function opsFor(tag, _detail, rid) {
  if (tag.startsWith('🔴 触发返回')) return { op: 'RERUN', rid, tag }
  if (tag.startsWith('↑ 升维候选')) return { op: 'LIFT', rid, tag }
  if (tag.startsWith('⚫ 伪矛盾') || tag.startsWith('↕ 振荡出口')) return { op: 'EITHER', rid, tag }
  if (tag.startsWith('↕ 方法用尽')) return { op: 'EITHER', rid, tag }
  if (tag.startsWith('↓ 降维候选')) return { op: 'SPLIT', rid, tag }
  if (tag.startsWith('⚠️ 从未观测')) return { op: 'OBSERVE', rid, tag }
  if (tag.startsWith('📉 档位下滑') || tag.startsWith('⚔️ 反证到达')) return { op: 'RERUN', rid, tag }
  return null
}

export function fingerprintOf(op) {
  const a = op.accepted, c = op.challenge
  if (a !== undefined && a !== null) return `ev:${a}:${c ?? 0}`
  if (c !== undefined && c !== null) return `ev:0:${c}`
  const f = op.conf
  return f !== undefined && f !== null ? `conf:${f}` : null
}

export function mergeClusters(ops, minN = CLUSTER_MIN) {
  const groups = new Map()
  const singles = []
  for (const o of ops) {
    const code = CLUSTERABLE[o.tag]
    if (code === undefined) { singles.push(o); continue }
    const key = `${o.op}|${o.tag}|${code}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(o)
  }
  const pooled = []
  for (const [, g] of groups) {
    if (g.length < minN) { singles.push(...g); continue }
    const members = g.map((x) => x.rid).sort()
    const first = g[0]
    pooled.push({
      op: first.op,
      rid: `POOL-${CLUSTERABLE[first.tag]}`,
      tag: first.tag,
      slug: CLUSTERABLE[first.tag],
      members,
      k: members.length,
      conf: members.length,
      accepted: g.reduce((a, x) => a + (x.accepted || 0), 0),
      challenge: g.reduce((a, x) => a + (x.challenge || 0), 0),
      detail: `${members.length} 条同形（${first.tag}）⇒ **一次处置覆盖整簇**（k=${members.length}，CAP 不用动）`,
    })
  }
  const out = singles.concat(pooled)
  out.sort((a, b) => (OP_ORDER[a.op] ?? 5) - (OP_ORDER[b.op] ?? 5)
    || (b.k ?? 1) - (a.k ?? 1)
    || (a.rid < b.rid ? -1 : a.rid > b.rid ? 1 : 0))
  return out
}

export function collectOps(entries, touched, roundLabel = null, ledger = 'ledger', cluster = true) {
  const ops = []
  const seen = new Set()
  for (const rid of [...touched].sort()) {
    const e = entries[rid]
    if (!e) continue
    for (const [tag, detail] of triggers(e, roundLabel, ledger)) {
      const op = opsFor(tag, detail, rid)
      if (!op) continue
      const k = `${rid}|${op.op}`
      if (seen.has(k)) continue
      seen.add(k)
      op.detail = detail
      op.conf = e.hist.length ? e.hist[e.hist.length - 1] : null
      op.accepted = e.accepted || 0
      op.challenge = e.challenge || 0
      ops.push(op)
    }
  }
  ops.sort((a, b) => (OP_ORDER[a.op] ?? 5) - (OP_ORDER[b.op] ?? 5)
    || (a.rid < b.rid ? -1 : a.rid > b.rid ? 1 : 0))
  return cluster ? mergeClusters(ops) : ops
}

export function take(ops, cap = CAP, debt = null, weights = null) {
  if (!ops || ops.length === 0) return [[], []]
  let arr = ops.slice()
  arr.sort((a, b) => (a.rid < b.rid ? -1 : a.rid > b.rid ? 1 : 0))
  if (debt && Object.keys(debt).length) {
    arr.sort((a, b) => (debt[`${b.op}·${b.rid}`] || 0) - (debt[`${a.op}·${a.rid}`] || 0))
  }
  if (weights && Object.keys(weights).length) {
    arr.sort((a, b) => (Number(weights[b.rid] ?? 0) - Number(weights[a.rid] ?? 0)))
  }
  arr.sort((a, b) => (OP_ORDER[a.op] ?? 5) - (OP_ORDER[b.op] ?? 5))
  if (cap === null || cap === undefined || arr.length <= cap) return [arr, []]
  const chosen = arr.slice(0, cap)
  const rest = arr.slice(cap)
  const dropped = rest.map((o) => {
    const n = (debt || {})[`${o.op}·${o.rid}`] || 0
    return {
      rid: o.rid, op: o.op, tag: o.tag,
      abandoned: `本节不处置 ${o.op}·${o.rid}`,
      cost: `该条报警保持未处置：${o.tag} 所指向的失效模式继续存在，且本条确信度 ${o.conf} 不再被复核`,
      re_evaluation_condition: '下一轮首件（饿死优先轮转）；或该条目确信度跌破地板时提前'
        + (n ? `【已连续放弃 ${n} 轮】` : ''),
      starved_rounds: n,
    }
  })
  return [chosen, dropped]
}

export function nodeFor(tasks, kind, rid) {
  const t = tasks[NID[kind].replace('{}', rid)]
  if (t) return t
  const kd = KIND_OF[kind]
  if (!kd) return null
  return findDerived(tasks, rid, kd)
}

export function findDerived(tasks, src, kind) {
  for (const t of Object.values(tasks)) if (t.src === src && t.kind === kind) return t
  return null
}

function depthOf(tasks, rid) {
  return (tasks[rid] || {}).depth || 0
}

export function waterline(tasks, rid) {
  const hits = []
  const perSrc = Object.values(tasks).filter((t) => t.src === rid).length
  if (perSrc >= BUDGET.per_src) hits.push(`同根因派生 ${perSrc} ≥ 水位 ${BUDGET.per_src}`)
  const openDebt = Object.values(tasks).filter(
    (t) => (Array.isArray(t.budget_debt) ? t.budget_debt.length > 0 : !!t.budget_debt),
  ).length
  if (openDebt >= BUDGET.open_debt) hits.push(`未结欠债 ${openDebt} ≥ 水位 ${BUDGET.open_debt}`)
  return hits
}

export function applyOps(gs, ops, label, ctr = { lift: 0, split: 0, obs: 0, seq: 0 }) {
  const tasks = gs.tasks
  const changes = []
  const newNodes = []

  for (const op of ops) {
    const kind = op.op
    const rid = op.rid
    const fp = fingerprintOf(op)
    const fpMissing = fp === null && NID[kind] !== undefined
    const isPool = !!op.members

    if (fp !== null && NID[kind] !== undefined) {
      if (isPool) {
        gs.pool_fp = gs.pool_fp || {}
        if (gs.pool_fp[`${kind}·${rid}`] === fp) continue
      } else {
        const ex = nodeFor(tasks, kind, rid)
        if (ex && ex.last_fp === fp) continue
      }
    }

    if (kind === 'RERUN') {
      const riders = op.members || [rid]
      const top = currentTop(gs)
      if (top && top.kind !== 'review') {
        top.executable = false
        top.blocked_reason = `被【${op.tag || '报警'}·${rid}】叫停：本层结论被动摇，须先重判`
        changes.push(`STOP·${top.id} 叫停（${String(top.title).slice(0, 26)}）`)
      }
      for (const r of riders) {
        const nid = `V-${r}`
        ctr.seq = (ctr.seq || 0) + 1
        if (tasks[nid]) {
          tasks[nid].executable = true
          tasks[nid].seq = ctr.seq
          changes.push(`RESUME·${nid} 重新置顶（${r} 收到反证，待复核）`)
        } else {
          tasks[nid] = {
            id: nid, title: `重判 ${r}：本层结论被动摇，重新走 Q0~Q3`,
            relation: 'prereq', d: 0.6, d_source: '机制强制·触发返回',
            parent: null, status: 'pending', executable: true, blocked_reason: '',
            kind: 'review', seq: ctr.seq, src: r, depth: depthOf(tasks, r) + 1,
            done_when: DONE_WHEN.review, resolution_type: 'redetermine', merge_method: null,
            created_by_action: `${kind}·${label}`, budget_debt: waterline(tasks, r),
          }
          changes.push(`RERUN·新开 ${nid}（重判 ${r}，指派为下一步）`)
          newNodes.push(nid)
        }
      }
      if (riders.length > 1) {
        changes.push(`合·RERUN 整簇：${riders.length} 条同形（${op.tag}）一次叫停、逐条开重判`
          + `（k=${riders.length}，CAP 不用动）`)
      }
    } else if (kind === 'LIFT' || kind === 'EITHER') {
      const ex = findDerived(tasks, rid, 'lift')
      ctr.seq = (ctr.seq || 0) + 1
      if (ex) {
        ex.executable = true
        ex.seq = ctr.seq
        changes.push(`RESUME·${ex.id} 重新置顶（源 ${rid}，同根因不重复开）`)
      } else {
        ctr.lift = (ctr.lift || 0) + 1
        const nid = `L-${rid}`
        tasks[nid] = {
          id: nid, title: `升维重问（源 ${rid}）`,
          relation: 'prereq', d: 0.6, d_source: '机制强制·本层判死',
          parent: null, status: 'pending', executable: true, blocked_reason: '',
          kind: 'lift', seq: ctr.seq, src: rid, depth: depthOf(tasks, rid) + 1,
          done_when: DONE_WHEN.lift, resolution_type: 'merge', merge_method: '换域',
          created_by_action: `${kind}·${label}`, budget_debt: waterline(tasks, rid),
          variables: [], old_variables: [], claim: '',
        }
        changes.push(`LIFT·新开 ${nid}（升维重问 ${rid}）`)
        newNodes.push(nid)
      }
    } else if (kind === 'SPLIT') {
      const ex = findDerived(tasks, rid, 'split')
      ctr.seq = (ctr.seq || 0) + 1
      if (ex) {
        ex.executable = true
        ex.seq = ctr.seq
        changes.push(`RESUME·${ex.id} 重新置顶（源 ${rid}，同根因不重复开）`)
      } else {
        ctr.split = (ctr.split || 0) + 1
        const nid = `S-${rid}`
        tasks[nid] = {
          id: nid, title: `降维拆分（源 ${rid}）：切最小可达子问题，让证据重新产生`,
          relation: 'prereq', d: 0.6, d_source: '机制强制·水位在损失',
          parent: null, status: 'pending', executable: true, blocked_reason: '',
          kind: 'split', seq: ctr.seq, src: rid, depth: depthOf(tasks, rid) + 1,
          done_when: DONE_WHEN.split, resolution_type: 'merge', merge_method: '降维',
          created_by_action: `${kind}·${label}`, budget_debt: waterline(tasks, rid),
        }
        changes.push(`SPLIT·新开 ${nid}（降维拆分 ${rid}）`)
        newNodes.push(nid)
      }
    } else if (kind === 'OBSERVE') {
      const ex = findDerived(tasks, rid, 'observe')
      ctr.seq = (ctr.seq || 0) + 1
      if (ex) {
        ex.executable = true
        ex.seq = ctr.seq
        changes.push(`RESUME·${ex.id} 重新置顶（源 ${rid}）`)
      } else {
        ctr.obs = (ctr.obs || 0) + 1
        const nid = `O-${rid}`
        const members = op.members
        const title = members
          ? `补一批观测（${members.length} 条同形）：${members.slice(0, 3).join('、')}… ⇒ 整池脱离观测盲区`
          : `补一次观测（${rid}）：产生第一条**观测类**证据`
        const done = members
          ? `覆盖的 ${members.length} 条**各自**至少产生 1 条观测类新证据（整批完成，不是单条完成）`
          : DONE_WHEN.observe
        tasks[nid] = {
          id: nid, title, relation: 'prereq', d: 0.5, d_source: '机制强制·从未观测',
          parent: null, status: 'pending', executable: true, blocked_reason: '',
          kind: 'observe', seq: ctr.seq, src: rid, depth: depthOf(tasks, rid) + 1,
          done_when: done, covers: members || [rid],
          resolution_type: 'evidence', merge_method: members ? '同形簇' : null,
          created_by_action: `${kind}·${label}`, budget_debt: waterline(tasks, rid),
        }
        changes.push(members
          ? `OBSERVE·池子级新开 ${nid}（覆盖 ${members.length} 条，k=${members.length}）`
          : `OBSERVE·新开 ${nid}（源 ${rid}）`)
        newNodes.push(nid)
      }
    }

    if (fp !== null && NID[kind] !== undefined) {
      if (isPool) {
        gs.pool_fp = gs.pool_fp || {}
        gs.pool_fp[`${kind}·${rid}`] = fp
      } else {
        const node = nodeFor(tasks, kind, rid)
        if (node) node.last_fp = fp
      }
    } else if (fpMissing) {
      changes.push(`⚠️ ${kind}·${rid} 无证据指纹（调用方未带 accepted/challenge）⇒ 本次幂等不可保证`)
    }
  }

  const uniq = []
  for (const c of changes) if (!uniq.includes(c)) uniq.push(c)
  return [uniq, newNodes]
}

export function currentTop(gs) {
  const tasks = gs.tasks
  const runnable = Object.values(tasks).filter((t) => t.status !== 'done' && t.executable !== false)
  if (!runnable.length) return null
  return runnable.reduce((best, t) => {
    const w = (t.d ?? 0) + (t.relation === 'prereq' ? 0.2 : 0)
    const bw = (best.d ?? 0) + (best.relation === 'prereq' ? 0.2 : 0)
    if (w > bw) return t
    if (w === bw && (t.seq || 0) > (best.seq || 0)) return t
    return best
  })
}

export function directionOf(gs) {
  const tasks = gs.tasks
  const alive = Object.values(tasks).filter((t) => t.status !== 'done')
  if (!alive.length) return { top: null, nBlocked: 0, nAlive: 0 }
  return {
    top: currentTop(gs)?.id ?? null,
    nBlocked: alive.filter((t) => t.executable === false).length,
    nAlive: alive.length,
  }
}

export function newVars(claimVars, oldVars) {
  const old = new Set(oldVars || [])
  return [...new Set(claimVars || [])].filter((v) => !old.has(v))
}

export function diagnoseLift(node, oldVars) {
  const vars = Array.isArray(node.variables) ? node.variables : []
  const nv = newVars(vars, oldVars)
  if (!vars.length) {
    return { ok: false, kind: '执', newVars: [],
      why: '节点未携带结构化 `variables` ⇒ 问不出"有没有新变量"⇒ 按定义判**执**（守旧边界）' }
  }
  return nv.length
    ? { ok: true, kind: '取', newVars: nv, why: `引入旧层不存在的变量：${nv.join('、')}` }
    : { ok: false, kind: '执', newVars: [], why: '变量集合与旧层完全相同 ⇒ 换了说法没换层（这正是「为者败之」反对的执）' }
}

export function repoolNeeded(nUndet, nTotal) {
  return nUndet >= UNKNOWN_WATERLINE || nUndet / Math.max(1, nTotal) >= UNKNOWN_RATE
}

export function newCard(rid, definition = {}) {
  return {
    rid,
    root: definition.root ?? null,
    layer: definition.layer ?? null,
    definition: {
      kind: definition.kind ?? '未取',
      criterion: definition.criterion ?? '',
      boundary: definition.boundary ?? '',
      taken_at: definition.taken_at ?? null,
    },
    status: '新起',
    transfer_to: null,
    commits: [],
  }
}

export function commit(card, what, at = null) {
  card.commits.push({ at: at ?? new Date().toISOString(), what })
  return card
}

export function backToEmpty(card, why, at = null) {
  card.status = '已回到空'
  card.transfer_to = null
  card.definition = { kind: '未取', criterion: '', boundary: '', taken_at: at ?? new Date().toISOString() }
  card.commits.push({ at: at ?? new Date().toISOString(), what: `回到空：${why}` })
  return card
}

export function dispatch(card, question, to = 'agent') {
  card.commits.push({ at: new Date().toISOString(), what: `分发：${question} → ${to}` })
  return card
}
