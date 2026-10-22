
export function fishMouth({ impact = 0.5, uncertainty = 0.5, coupling = 0.5 } = {}) {
  const w = (clamp01(impact) + clamp01(uncertainty) + clamp01(coupling)) / 3
  const w3 = Number(w.toFixed(3))
  const level = w3 >= 0.66 ? 'heavy' : w3 >= 0.4 ? 'normal' : 'light'
  return {
    weight: Number(w.toFixed(3)),
    level,
    route: level === 'heavy'
      ? '走重流程：先建模+假设显式化（A1/A2）→ 矛盾分与合 → 举证 → 人确认门'
      : level === 'normal'
        ? '走常规流程：直接取 → 自查 → 举证'
        : '走轻流程：直接做，只留一条可核事实（**不套流程**）',
    why: `影响 ${impact} / 不确定 ${uncertainty} / 耦合 ${coupling} 的平均 = ${w.toFixed(3)} ⇒ ${level}`,
  }
}

export function flyingSand({ budgetUsed = 0, budgetTotal = 100, stuck = false, ctxFull = false } = {}) {
  const pct = budgetTotal > 0 ? budgetUsed / budgetTotal : 0
  if (pct >= 1) {
    return { overflow: true, action: '降级收尾', why: `预算用完（${budgetUsed}/${budgetTotal}）⇒ 把当前成果冻结、标"待定"、写清还差什么（**不卡死**）` }
  }
  if (pct >= 0.8) {
    return { overflow: true, action: '降级提醒', why: `预算已用 ${Math.round(pct * 100)}%（≥80%）⇒ 只做"能收口的那一件"，别再开新的` }
  }
  if (stuck) return { overflow: true, action: '降级换路', why: '检测到打转 ⇒ 停止重试，改走逃逸动作（换域/反演/升维/外部锚点）' }
  if (ctxFull) return { overflow: true, action: '降级落盘', why: '上下文将满 ⇒ 先把状态写进文件（状态外置），再从文件续' }
  return { overflow: false, action: '正常', why: `预算 ${Math.round(pct * 100)}%，无溢出条件` }
}

export function bottleNeck({ cmdSeconds = 0, limit = 30 } = {}) {
  const s = Number(cmdSeconds)
  if (!Number.isFinite(s) || s <= 0) return { split: false, why: '没有耗时数据 ⇒ 不猜（先量再拆）' }
  if (s <= limit) return { split: false, why: `${s}s ≤ ${limit}s ⇒ 不拆` }
  const pieces = Math.ceil(s / limit)
  return {
    split: true,
    pieces,
    why: `${s}s > ${limit}s ⇒ **自动拆细**：拆成约 ${pieces} 步，每步各自可验（一步一绿，不是一次跑完再判）`,
    how: `把一条 ${s}s 的验收拆成 ${pieces} 条 ≤${limit}s 的子验收；每条独立给退出码`,
  }
}

export function waterlines({ budgetUsed = 0, budgetTotal = 100, unknownOpen = 0, spinStreak = 0, confFlip = 0 } = {}) {
  const hits = []
  const pct = budgetTotal > 0 ? budgetUsed / budgetTotal : 0
  if (pct >= 0.8) hits.push({ line: '预算 80%', value: `${Math.round(pct * 100)}%`, action: '只做能收口的那一件' })
  if (unknownOpen >= 10) hits.push({ line: '未知池 10 条', value: String(unknownOpen), action: '先分类或拒收（reject 要写理由）' })
  if (spinStreak >= 2) hits.push({ line: '打转连 2 次', value: String(spinStreak), action: '强制改走逃逸动作' })
  if (confFlip >= 3) hits.push({ line: '置信度震荡', value: String(confFlip), action: '判断层没把握 ⇒ 升级人工（Jev ESCALATE_HUMAN）' })
  return {
    hit: hits.length > 0,
    hits,
    why: hits.length ? `触线 ${hits.length} 条：${hits.map((h) => h.line).join('、')}` : '未触线',
  }
}

export function terrain(input = {}) {
  return {
    fish: fishMouth(input.task || {}),
    sand: flyingSand(input.budget || {}),
    bottle: bottleNeck(input.verify || {}),
    lines: waterlines(input.lines || {}),
  }
}

export function canStop({ delivery = {}, openItems = [], budget = {}, unknownOver = null } = {}) {
  const facts = Array.isArray(delivery.facts) ? delivery.facts.filter((x) => String(x || '').trim()) : []
  const c1 = facts.length > 0 || Number(delivery.done || 0) > 0

  const items = Array.isArray(openItems) ? openItems : []
  const noNext = items.filter((x) => !String(x?.next || '').trim())
  const c2 = noNext.length === 0

  const pct = Number(budget.pct ?? (budget.total > 0 ? (budget.used || 0) / budget.total : 0))
  const c3 = Boolean(budget.byHuman) || pct >= 0.8

  const c4 = unknownOver === null ? true : unknownOver !== true

  const misses = []
  if (!c1) misses.push('交付物还没成可核事实（账绿 ≠ 做完了）')
  if (!c2) misses.push(`有 ${noNext.length} 条未结项没写"下次从哪接"`)
  if (!c3) misses.push(`预算只用了 ${Math.round(pct * 100)}% 且没人叫停`)
  if (!c4) misses.push('未知池超线：未处理的契约外观察 > 水位 ⇒ 原文"不能标记完成"；出口是 absorb 或 reject（reject 要写理由）')

  const allOk = c1 && c2 && c3 && c4

  return {
    ok: allOk,
    c1, c2, c3, c4,
    misses,
    brief: allOk
      ? `✅ 可以停：交付物 ${facts.length || Number(delivery.done || 0)} 件成事实、${items.length} 条未结项有接点、预算 ${Math.round(pct * 100)}%${budget.byHuman ? '（人叫停）' : ''}`
      : `🔴 现在停不正当：\n${misses.map((x) => `  · ${x}`).join('\n')}`,
  }
}

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0))
