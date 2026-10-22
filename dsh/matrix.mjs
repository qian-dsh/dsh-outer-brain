
import * as LD from './layer.mjs'

export const L2_K = 3
export const L3_K = 3
export const CHANNEL_TAGS = { L1: '步/轮', L2: '段/批', L3: '项目' }

function num(v) {
  return Number.isFinite(Number(v)) ? Number(v) : 0
}

export const CALIBER = {
  verdict: 2,
  aim: 2,
}

function voidIfStale(mx) {
  const l3 = mx.L3
  const cur = l3.caliber || {}
  const stale = []
  if (num(cur.verdict) !== CALIBER.verdict) stale.push(`verdict:${num(cur.verdict)}→${CALIBER.verdict}`)
  if (num(cur.aim) !== CALIBER.aim) stale.push(`aim:${num(cur.aim)}→${CALIBER.aim}`)
  if (!stale.length) return false
  const before = {
    stiffRounds: num(l3.stiffRounds), aimBadRounds: num(l3.aimBadRounds),
    satRounds: num(l3.satRounds), movesTotal: num(l3.movesTotal), dropsTotal: num(l3.dropsTotal),
  }
  const hadSomething = Object.values(before).some((v) => v > 0)
  l3.stiffRounds = 0
  l3.aimBadRounds = 0
  l3.satRounds = 0
  l3.movesTotal = 0
  l3.dropsTotal = 0
  l3.caliber = { verdict: CALIBER.verdict, aim: CALIBER.aim }
  if (hadSomething) {
    l3.voided = [...(l3.voided || []), {
      at_seq: mx.seq ?? null, from: stale.join(','), before,
      why: '口径变更 ⇒ 旧累计不可比，判据产物作废（事实计数保留）',
    }].slice(-8)
  }
  return true
}

export function newMatrix() {
  return {
    schema: 2,
    seq: 0,
    lastRowAt: null,
    L1: [],
    L2: [],
    L3: {
      rolls: 0,
      lastRound: null,
      direction: null,
      directionChanges: 0,
      capViolations: 0,
      zeroAdopt: null,
      updatedRound: null,
      updatedSeq: null,
      stiffRounds: 0,
      movesTotal: 0,
      dropsTotal: 0,
      satRounds: 0,
      aimBadRounds: 0,
      roundsCounted: 0,
      caliber: { ...CALIBER },
      voided: [],
    },
  }
}

export function reviewLights(pool) {
  const out = []
  for (const [rid, e] of Object.entries(pool?.entries || {})) {
    const ch = Number(e.challenge || 0)
    const pend = Number(e.chal_since_review || 0)
    const asg = Number(e.review_assigned || 0)
    const logs = (e.review_log || []).length
    if (ch > 0 && pend === 0 && logs === 0) {
      out.push(`🔴 判据说谎 ${rid}：challenge=${ch} 却待复核账=0 且无完成记录`)
    } else if (pend > 0 && asg > 0) {
      out.push(`🟠 指派未完成 ${rid}：待复核 ${pend} 条／已指派 ${asg} 次／完成 0 次`)
    }
  }
  return out
}

export function zeroAdoptLight(pool, roundsSeen) {
  const ents = Object.values(pool?.entries || {})
  if (!ents.length) {
    return { lit: true, why: '池中 0 条 —— 本会话**没在观测软判断**'
      + '（这类才走 brain_observe：用户到底想要什么 / 这个取舍值不值 / 这个风险能不能接受）。'
      + '工程观测（退出码 / 文件在不在 / 读数对不对）请走 `done_when` + 陪审，不要塞进池子。' }
  }
  const accept = ents.reduce((a, e) => a + (e.accepted || 0), 0)
  if (accept === 0 && roundsSeen >= 1) {
    return { lit: true, why: `池中 ${ents.length} 条、累计采纳 0 次 ⇒ 这个池子从未通电` }
  }
  return { lit: false, why: `累计采纳 ${accept} 次` }
}

export function pushL1(mx, row) {
  mx.seq = num(mx.seq) + 1
  const r = {
    seq: mx.seq,
    round: row.round,
    alarms: row.alarms ?? 0,
    cap: row.cap ?? null,
    chosen: row.chosen || [],
    dropped: row.dropped || [],
    directionChanged: !!row.directionChanged,
    capRespected: (row.chosen || []).length <= (row.cap ?? Infinity),
    caliber_v: CALIBER.verdict,
    caliber_aim: CALIBER.aim,
    p_mean: row.p_mean ?? null,
    p_delta: row.p_delta ?? null,
    p_delta_signed: row.p_delta_signed ?? null,
    moves: (row.moves || []).slice(0, 8),
    n_moves: row.n_moves === undefined || row.n_moves === null ? (row.moves || []).length : row.n_moves,
    n_drops: row.n_drops === undefined || row.n_drops === null
      ? (row.moves || []).filter((m) => m.dir === 'down').length : row.n_drops,
    n_sat: row.n_sat ?? 0,
    contested: row.contested ?? 0,
    verdict: (() => {
      const nm = row.n_moves === undefined || row.n_moves === null ? (row.moves || []).length : row.n_moves
      if (row.p_mean === null || row.p_mean === undefined) return 'unknown'
      if (nm > 0) return '在动'
      if (Number(row.p_delta) >= 0.005) return '在动'
      if (Number(row.n_sat) > 0) return '饱和'
      return (row.chosen || []).length ? '僵' : '静'
    })(),
    contra_open: row.contra_open ?? null,
    contra_max_level: row.contra_max_level ?? null,
    contra_parked: row.contra_parked ?? null,
    contra_fake: row.contra_fake ?? null,
    contra_climbed: row.contra_climbed ?? null,
    contra_retake: row.contra_retake ?? null,
    contra_root: row.contra_root ?? null,
    aim: row.aim ?? null,
    aim_top: row.aim_top ?? null,
    aim_focus: row.aim_focus ?? null,
    aim_bad: !!row.aim_bad,
  }
  mx.L1.push(r)
  rollL2(mx)
  return r
}

function rollL2(mx) {
  while (mx.L1.length >= L2_K) {
    const seg = mx.L1.splice(0, L2_K)
    const row = {
      from: seg[0].round,
      to: seg[seg.length - 1].round,
      seqFrom: num(seg[0]?.seq) || null,
      seqTo: num(seg[seg.length - 1]?.seq) || null,
      members: seg.map((r) => num(r.seq)).filter((s) => s > 0),
      n: seg.length,
      alarms: seg.reduce((a, r) => a + r.alarms, 0),
      actions: seg.flatMap((r) => r.chosen),
      capViolations: seg.filter((r) => !r.capRespected).length,
      directionChanges: seg.filter((r) => r.directionChanged).length,
      contraMaxLevel: seg.reduce((m, r) => Math.max(m, r.contra_max_level ?? 0), 0),
      contraClimbed: seg[seg.length - 1]?.contra_climbed ?? 0,
      p_mean: (() => { const v = seg.map((r) => r.p_mean).filter(Number.isFinite)
        return v.length ? v.reduce((a, c) => a + c, 0) / v.length : null })(),
      p_delta_sum: seg.reduce((a, r) => a + (Number.isFinite(r.p_delta) ? r.p_delta : 0), 0),
      p_delta_signed_sum: seg.reduce((a, r) => a + (Number.isFinite(r.p_delta_signed) ? r.p_delta_signed : 0), 0),
      moves: seg.flatMap((r) => r.moves || []).slice(0, 12),
      n_moves: seg.reduce((a, r) => a + num(r.n_moves), 0),
      n_drops: seg.reduce((a, r) => a + num(r.n_drops), 0),
      n_sat: seg.reduce((a, r) => a + num(r.n_sat), 0),
      stiff: seg.filter((r) => r.verdict === '僵').length,
      silent: seg.filter((r) => r.verdict === '静').length,
      sat: seg.filter((r) => r.verdict === '饱和').length,
      n_v2: seg.filter((r) => num(r.caliber_v) === CALIBER.verdict).length,
      stiff_v2: seg.filter((r) => num(r.caliber_v) === CALIBER.verdict && r.verdict === '僵').length,
      sat_v2: seg.filter((r) => num(r.caliber_v) === CALIBER.verdict && r.verdict === '饱和').length,
      aimBad_v2: seg.filter((r) => num(r.caliber_aim) === CALIBER.aim && r.aim_bad).length,
      aim_mean: (() => { const v = seg.map((r) => r.aim).filter(Number.isFinite)
        return v.length ? v.reduce((a, c) => a + c, 0) / v.length : null })(),
      aim_bad: seg.filter((r) => r.aim_bad).length,
    }
    row.lost = [
      LD.projectLoss({
        what: 'moves 明细',
        kept: (row.moves || []).length,
        total: seg.reduce((a, r) => a + num((r.moves || []).length), 0),
        why: 'L1→L2 截断（上限 12 条）',
      }),
      LD.projectLoss({
        what: 'verdict 四态',
        kept: 3,
        total: 4,
        why: '「在动」没有计数 ⇒ 段层答不出"这一段在动了几轮"',
      }),
    ].filter((x) => x.total > 0)
    mx.L2.push(row)
    rollL3(mx)
  }
}

function rollL3(mx) {
  while (mx.L2.length >= L3_K) {
    const seg = mx.L2.splice(0, L3_K)
    const l3 = mx.L3
    voidIfStale(mx)
    l3.rolls = num(l3.rolls) + 1
    l3.lastRound = seg[seg.length - 1].to
    const lastSeq = num(seg[seg.length - 1]?.seqTo)
    l3.updatedSeq = lastSeq > 0 ? lastSeq : null
    l3.directionChanges = num(l3.directionChanges) + seg.reduce((a, r) => a + num(r.directionChanges), 0)
    l3.capViolations = num(l3.capViolations) + seg.reduce((a, r) => a + num(r.capViolations), 0)
    l3.stiffRounds = num(l3.stiffRounds) + seg.reduce((a, r) => a + num(r.stiff_v2), 0)
    l3.movesTotal = num(l3.movesTotal) + seg.reduce((a, r) => a + num(r.n_moves), 0)
    l3.dropsTotal = num(l3.dropsTotal) + seg.reduce((a, r) => a + num(r.n_drops), 0)
    l3.satRounds = num(l3.satRounds) + seg.reduce((a, r) => a + num(r.sat_v2), 0)
    l3.aimBadRounds = num(l3.aimBadRounds) + seg.reduce((a, r) => a + num(r.aimBad_v2), 0)
    l3.roundsCounted = num(l3.roundsCounted) + seg.reduce((a, r) => a + num(r.n), 0)
    l3.updatedRound = seg[seg.length - 1].to
    const winBefore = (l3.window || []).length
    l3.window = [...(l3.window || []), ...seg.map((r) => ({
      id: `${num(r.seqFrom)}-${num(r.seqTo)}`,
      seqFrom: num(r.seqFrom) || null, seqTo: num(r.seqTo) || null,
      members: (r.members || []).slice(0, L2_K),
      n: num(r.n), p_mean: r.p_mean ?? null, aim_mean: r.aim_mean ?? null,
      stiff: num(r.stiff), sat: num(r.sat), silent: num(r.silent),
      n_moves: num(r.n_moves), n_drops: num(r.n_drops),
      moves: (r.moves || []).slice(0, 6),
    }))].slice(-L3_K)
    l3.members = seg.map((r) => `${num(r.seqFrom)}-${num(r.seqTo)}`)
    const keptMoves = l3.window.reduce((a, r) => a + (r.moves || []).length, 0)
    const totalMoves = seg.reduce((a, r) => a + num((r.moves || []).length), 0)
    l3.lost = [
      LD.projectLoss({
        what: 'moves 明细', kept: keptMoves, total: totalMoves,
        why: 'L2→L3：窗口只留最近几段、每段只留 6 条 ⇒ 更早的明细永久消失',
      }),
      LD.projectLoss({
        what: '段结构', kept: l3.window.length,
        total: winBefore + seg.length,
        why: 'L2→L3：窗口溢出后，更早那一段的 p_mean / 成员 / 段内均值不再保留',
      }),
    ].filter((x) => x.total > 0)
  }
}

export function roundAxis(mx, pool = null, st = null) {
  const m = mx || newMatrix()
  return {
    seq: num(m.seq),
    l3UpdatedSeq: m.L3?.updatedSeq ?? null,
    lag: m.L3?.updatedSeq === null || m.L3?.updatedSeq === undefined
      ? null : num(m.seq) - num(m.L3.updatedSeq),
    lastRoundLabel: m.L3?.lastRound ?? null,
    settledRounds: (pool?.rounds || []).length,
    mustAnswerIssued: st?.mustAnswer?.round ?? null,
  }
}

export function matrixView(mx) {
  const m = mx || newMatrix()
  const l1 = m.L1 || [], l2 = m.L2 || [], l3 = m.L3 || {}
  const layer = (level, unit, rows, extra = {}) => ({
    level, unit,
    n: rows.length,
    span: rows.length
      ? { from: num(rows[0]?.seq ?? rows[0]?.seqFrom), to: num(rows[rows.length - 1]?.seq ?? rows[rows.length - 1]?.seqTo) }
      : null,
    members: rows.flatMap((r) => r.members || [r.seq]).filter((s) => num(s) > 0),
    lost: rows.flatMap((r) => r.lost || []),
    ...extra,
  })
  const L1v = layer(1, CHANNEL_TAGS.L1, l1)
  const L2v = layer(2, CHANNEL_TAGS.L2, l2)
  const L3v = layer(3, CHANNEL_TAGS.L3, (l3.window || []), {
    rolls: num(l3.rolls),
    window: (l3.window || []).length,
    counters: {
      stiffRounds: num(l3.stiffRounds), satRounds: num(l3.satRounds),
      aimBadRounds: num(l3.aimBadRounds),
      movesTotal: num(l3.movesTotal), dropsTotal: num(l3.dropsTotal),
      roundsCounted: num(l3.roundsCounted),
    },
  })
  const chain = (l3.window || []).map((w) => ({
    id: w.id,
    to_l1: (w.members || []).length,
    missing_l1: (w.members || []).filter((s) => !l1.some((r) => num(r.seq) === num(s))).length,
  }))
  const broken = chain.filter((c) => c.to_l1 === 0)
  return {
    caliber: { ...(l3.caliber || {}) },
    seq: num(m.seq),
    whole: (() => {
      const from = num(l3.window?.[0]?.seqFrom) || num(l2[0]?.seqFrom) || num(l1[0]?.seq) || null
      const to = num(m.seq)
      const gap = (from && from > 1) ? from - 1 : 0
      return {
        from, to, gap,
        outside: '这个矩阵只覆盖"被推进行过的轮"；没推进的轮、注入之前的历史、'
          + '已经滚出窗口的更早的段、以及被截断的那些明细，都不在它里面 —— '
          + '它们不算"没问题"，算"没被看到"。',
      }
    })(),
    layers: { L1: L1v, L2: L2v, L3: L3v },
    chain,
    broken: broken.length,
    summary: {
      lostMoves: [...L1v.lost, ...L2v.lost, ...L3v.lost]
        .filter((x) => x.what === 'moves 明细')
        .reduce((a, x) => a + num(x.dropped), 0),
      lostMovesTotal: [...L1v.lost, ...L2v.lost, ...L3v.lost]
        .filter((x) => x.what === 'moves 明细')
        .reduce((a, x) => a + num(x.total), 0),
      brokenLinks: broken.length,
      covered: num(m.seq),
    },
  }
}

export function matrixLights(mx, pool, currentRound = null) {
  const lights = []
  const z = zeroAdoptLight(pool, (mx.L1.length || 0) + (mx.L2.length || 0) * L2_K)
  mx.L3.zeroAdopt = z.lit
  if (z.lit) lights.push(`⚪ 池子未通电（机制自身状态）：${z.why}`)

  const bad = [...mx.L1, ...mx.L2].filter((r) => r.capRespected === false)
  const capBad = bad.length + (mx.L3.capViolations || 0)
  if (capBad > 0) lights.push(`🔴 额度口径被破 ${capBad} 次（步层 chosen 超过 CAP）`)

  const ax = roundAxis(mx, pool)
  if (num(mx.L3.rolls) === 0) {
    lights.push(`🟡 L3 项目层从未滚动（需累计 ${L3_K}×${L2_K}=${L3_K * L2_K} 轮；已数 ${ax.seq} 轮）`)
  }
  if (mx.L1.length >= L2_K || mx.L2.length >= L3_K) {
    lights.push(`🔴 滚动未执行：L1 攒了 ${mx.L1.length} 行（阈值 ${L2_K}）、`
      + `L2 攒了 ${mx.L2.length} 段（阈值 ${L3_K}）却没滚 ⇒ 有入口绕过了 pushL1`)
  }

  const sameV = (r) => num(r.caliber_v) === CALIBER.verdict
  const sameA = (r) => num(r.caliber_aim) === CALIBER.aim
  const l3OkV = num(mx.L3.caliber?.verdict) === CALIBER.verdict
  const l3OkA = num(mx.L3.caliber?.aim) === CALIBER.aim
  const stiffTotal = (l3OkV ? num(mx.L3.stiffRounds) : 0)
    + mx.L2.reduce((a, r) => a + num(r.stiff_v2), 0)
    + mx.L1.filter((r) => sameV(r) && r.verdict === '僵').length
  const satTotal = (l3OkV ? num(mx.L3.satRounds) : 0)
    + mx.L2.reduce((a, r) => a + num(r.sat_v2), 0)
    + mx.L1.filter((r) => sameV(r) && r.verdict === '饱和').length
  const aimBadTotal = (l3OkA ? num(mx.L3.aimBadRounds) : 0)
    + mx.L2.reduce((a, r) => a + num(r.aimBad_v2), 0)
    + mx.L1.filter((r) => sameA(r) && r.aim_bad).length
  const staleRows = mx.L1.filter((r) => !sameV(r)).length
    + mx.L2.reduce((a, r) => a + Math.max(0, num(r.n) - num(r.n_v2)), 0)
  const lastVoid = (mx.L3.voided || []).slice(-1)[0] || null

  if (num(mx.L3.rolls) > 0 && num(mx.L3.roundsCounted) === 0) {
    lights.push(`🟡 L3 累计器已损坏（滚过 ${mx.L3.rolls} 次却记不上数）⇒ 空转/漂移的累计从本轮重算`)
  }

  const inL2 = mx.L2.reduce((a, r) => a + num(r?.n), 0)
  const total = num(mx.L1.length) + inL2 + num(mx.L3.roundsCounted)
  if (ax.seq !== total) {
    lights.push(`🔴 轮轴脱节：矩阵数了 ${ax.seq} 行，三层里却只有 ${total} 行`
      + `（L1 ${mx.L1.length} + L2 内含 ${inL2} + L3 已滚 ${num(mx.L3.roundsCounted)}）`
      + ` ⇒ 有行绕过了 pushL1，累计不可信`)
  }

  const noMoveTotal = stiffTotal + satTotal
  if (noMoveTotal >= 9) {
    if (satTotal >= stiffTotal) {
      lights.push(`🟠 判据饱和：${noMoveTotal} 轮 p 未变，其中 ${satTotal} 轮打在已到边界的取上（真僵 ${stiffTotal}）`
        + ` ⇒ **不是"它听了不动"，是这条取推不动了**：该换的是取（改 claim / 判死 / 拆分），不是催它多做`
        + `｜若你认为饱和不该豁免，判据在 CALIBER.verdict —— 把它 +1 就恢复红灯`)
    } else {
      lights.push(`🔴 系统空转：累计 ${stiffTotal} 轮有动作但 p 一动不动（听了、动了、信念没变）`
        + `（另饱和 ${satTotal} 轮；饱和过半则本灯自动降级 —— 见 CALIBER.verdict）`)
    }
  } else if (noMoveTotal >= 6) {
    lights.push(`🟠 疑似空转：连续 ${noMoveTotal} 轮 p 未变 —— 再不动就该回节点重取`)
  }

  const aimEverMeasured = [...mx.L1, ...mx.L2]
    .some((r) => Number.isFinite(Number(r?.aim)) && Number(r.aim) > 0)
  if (aimBadTotal >= 9 && !aimEverMeasured) {
    lights.push(`🟡 漂移灯失效（本灯不指控任何人）：累计 ${aimBadTotal} 轮 aim_bad，但**从没有一行量出过非零 aim**`
      + ` ⇒ 尺子分母是 0（最重项权重=0），这条判据在量自己。出口：查权重账（weightMap / qid 归属），不是查 agent`)
  } else if (aimBadTotal >= 9) {
    lights.push(`🔴 长任务漂移：累计 ${aimBadTotal} 轮注意力都不在最重项上（在最重的没动、在深处忙）`
      + `｜若最重项权重为 0 则本灯不成立（aim 无分母）`)
  } else if (aimBadTotal >= 6) {
    const cur = [...mx.L1].reverse().find((r) => r.aim_bad) || {}
    lights.push(`🟠 局部最优：${aimBadTotal} 轮在低权重处忙`
      + `（当前 aim≈${cur.aim === null || cur.aim === undefined ? '?' : Number(cur.aim).toFixed(2)}`
      + `，最重项 ${cur.aim_top ?? '?'} 没动）`)
  }

  if (!l3OkV || !l3OkA) {
    const by = num(mx.L3.caliber?.verdict), ay = num(mx.L3.caliber?.aim)
    lights.push(`⚪ L3 累计是旧口径（verdict:${by}/aim:${ay}，现行 ${CALIBER.verdict}/${CALIBER.aim}）`
      + ` ⇒ 空转 ${num(mx.L3.stiffRounds)} 轮 / 漂移 ${num(mx.L3.aimBadRounds)} 轮**本次不计入任何灯**`
      + `（下次滚动时归零并记 voided；判据产物的清零必须在留痕之后，不许静默）`)
  } else if (staleRows > 0) {
    lights.push(`⚪ 有 ${staleRows} 行是旧口径写的，未计入任何累计（不删，也不再当证据）`)
  }
  if (lastVoid) {
    lights.push(`⚪ 上一次口径作废（seq ${lastVoid.at_seq ?? '?'}｜${lastVoid.from}）：作废前 空转 ${num(lastVoid.before?.stiffRounds)} 轮 / 漂移 ${num(lastVoid.before?.aimBadRounds)} 轮`
      + `。若认为作废错了，把 CALIBER 改回去即恢复（留痕不删）`)
  }
  return lights
}

export function matrixSummary(mx, pool, currentRound = null, st = null) {
  const lights = matrixLights(mx, pool, currentRound)
  const ax = roundAxis(mx, pool, st)
  const out = [
    `矩阵三层：L1 窗口 ${mx.L1.length} 行 ｜ L2 待滚 ${mx.L2.length} 行 ｜ L3 已滚 ${mx.L3.rolls} 次`
      + (mx.L3.lastRound ? `（最末 ${mx.L3.lastRound}）` : ''),
    `轮轴：已数 ${ax.seq} 轮（权威计数）｜项目层跟到 `
      + (ax.l3UpdatedSeq ?? (num(mx.L3.rolls) > 0 ? `序号未知（已滚 ${num(mx.L3.rolls)} 次，累计器损坏）` : '从未滚动'))
      + `（落后 ${ax.lag ?? '-'}）｜agent 认账 ${ax.settledRounds} 次`
      + (ax.mustAnswerIssued === null ? '' : `｜必答单已下发 ${ax.mustAnswerIssued} 次`)
      + ` —— 后两个**不是轮**，与 seq 不等属正常`,
  ]
  out.push(lights.length ? `红灯：${lights.join('；')}` : '红灯：（无）')
  const l3m = mx.L3 || {}
  const agg = (kL3, kRow) => num(l3m[kL3])
    + mx.L2.reduce((a, r) => a + num(r[kRow]), 0)
    + mx.L1.reduce((a, r) => a + num(r[kRow]), 0)
  const mv = agg('movesTotal', 'n_moves'), dp = agg('dropsTotal', 'n_drops'), stt = agg('satRounds', 'n_sat')
  out.push(`置信度：累计真变动 ${mv} 次（其中**降** ${dp} 次）｜打到边界推不动 ${stt} 次`
    + (mv === 0
      ? ` ⇒ 已数 ${ax.seq} 轮里**没有任何一条「取」被新证据改变过**：矩阵在记动作，不在记学习`
      : (dp === 0 ? ' ⇒ 只升不降：系统只在自证，不在怀疑（每一句话都是取，取必有被推翻的可能）' : '')))
  return out
}
