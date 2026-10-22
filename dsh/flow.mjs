
import * as PC from './perceive.mjs'
import * as CB from './combine.mjs'
import * as TER from './terrain.mjs'
import * as SPIN from './spin.mjs'
import * as U from './unknown.mjs'
import * as AG from './aggregate.mjs'

export const LOOP = Object.freeze({ INNER: 'inner', OUTER: 'outer' })

export function tick(st = {}, opt = {}) {
  const p = PC.perceive(st)

  const spin = SPIN.detect(opt.steps || [], opt.spin || {})
  const uWater = U.waterline(st.unknown || {}, opt.cfg || {})

  const t = TER.terrain({
    task: opt.task || {},
    budget: opt.budget || {},
    verify: opt.verify || {},
    lines: {
      ...(opt.budget || {}),
      unknownOpen: uWater.open,
      spinStreak: spin.streak,
      confFlip: Number(opt.confFlip || 0),
    },
  })

  const outerReasons = []
  const outerActions = []
  if (t.sand.overflow) {
    outerReasons.push(`飞沙堰：${t.sand.why}`)
    outerActions.push({
      kind: 'budget',
      do: '二选一：① 收口（把未做完的标 dropped 并写 why）；② 抬总预算（root_budget）并说明为什么值',
      cost: '抬了就要继续烧；不抬而硬撑 ⇒ 后面每一轮都在透支，判据会开始应付了事',
    })
  }
  if (t.lines.hit) {
    outerReasons.push(`水位线：${t.lines.why}`)
    outerActions.push({
      kind: 'waterline',
      do: '看是哪条线：预算线 ⇒ 同飞沙堰；未知池线 ⇒ 集中分类/拒收一轮；打转线 ⇒ 换层（见下）',
      cost: '扩水位线只会让积压更多；不扩就得这一轮停下来处理',
    })
  }
  if (spin.mustStop) {
    outerReasons.push(`打转：${spin.report}`)
    outerActions.push({
      kind: 'ring',
      do: `换一层再试：${(spin.escape || []).map((e) => e.kind || e).join(' / ') || '换域 / 反演 / 升维'}`,
      cost: '换层要重写判据（旧判据在新层不成立）；不换 ⇒ 会用同一种手法把同一个错再犯一遍',
    })
  }
  if (uWater.over) {
    outerReasons.push(`未知池：${uWater.why}`)
    outerActions.push({
      kind: 'unknown',
      do: `把 ${uWater.open} 条未处理的逐条分类或拒收（reject 要写理由），处理完再继续`,
      cost: '不处理 ⇒ 原文口径「未处理超线不许标完成」，收口那一步会被拒',
    })
  }

  const loop = outerReasons.length ? LOOP.OUTER : LOOP.INNER

  let combineGate = null
  if (loop === LOOP.INNER && p.main) combineGate = CB.combineFirst(p.main)

  const agg = AG.aggregate({ perceive: p, terrain: t, spin: spin.mustStop ? spin : null, unknown: uWater })

  return {
    loop,
    ring: p.ring,
    main: p.main,
    terrain: t,
    spin: spin.mustStop ? spin : null,
    unknown: { open: uWater.open, over: uWater.over },
    outerReasons,
    outerActions,
    combineGate,
    agg,
    brief: buildBrief({ loop, p, t, spin, uWater, outerReasons }),
  }
}

function buildBrief({ loop, p, t, spin, uWater, outerReasons }) {
  if (loop === LOOP.OUTER) {
    return [
      `【外回路 · 该人了】${outerReasons.length} 条触线：`,
      ...outerReasons.map((x) => `  · ${x}`),
      '  ⇒ 这三件**人来定**：扩预算 / 换环 / 重新取（机制不自己换环，原文 §五 调节层）',
    ].join('\n')
  }
  const lines = [`【内回路】环=${p.ring}`]
  if (p.main) {
    lines.push(`  主要矛盾：${p.main.id}（强度 ${Number(p.main.strength).toFixed(2)}）${p.main.why}`)
    lines.push('  ⇒ **先试四种合**（升维/降维/换域/重构），合不了再取舍（要写代价+if_wrong）')
  } else {
    lines.push(`  主要矛盾：暂无（${p.why}）`)
  }
  if (p.ring === 'stuck') lines.push('  ⚠️ 环=stuck（验证反复不绿）⇒ 别再加判据，先怀疑"这条需求本身"')
  if (t.bottle.split) lines.push(`  🔧 宝瓶口：${t.bottle.how}`)
  if (uWater.open) lines.push(`  · 未知池 ${uWater.open} 条未处理`)
  if (spin) lines.push(`  ${spin.report}`)
  return lines.join('\n')
}
