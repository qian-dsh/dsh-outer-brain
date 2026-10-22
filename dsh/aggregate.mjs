
export const PRI = Object.freeze({
  STOP: 1,
  ASK: 2,
  UNSTICK: 3,
  DO: 4,
})

export function aggregate({ perceive = null, stop = null, terrain = null, spin = null, jev = null, unknown = null, falsify = null } = {}) {
  const items = []

  if (stop && stop.ok === true) items.push({ pri: PRI.STOP, kind: 'stop', text: stop.brief })
  else if (terrain?.sand?.overflow) items.push({ pri: PRI.STOP, kind: 'stop', text: `飞沙堰：${terrain.sand.why}` })

  if (jev && !jev.degraded && jev.action === 'ESCALATE_HUMAN') {
    items.push({ pri: PRI.ASK, kind: 'ask', text: `把握 ${Number(jev.strength).toFixed(2)} < 0.60 ⇒ **先问他**（别用"我以为"替代"他说过"）` })
  }
  if (unknown?.over) items.push({ pri: PRI.ASK, kind: 'ask', text: `未知池 ${unknown.open}>${unknown.limit} ⇒ 先分类或拒收（reject 要写理由）` })

  if (spin?.mustStop) items.push({ pri: PRI.UNSTICK, kind: 'unstick', text: spin.report })

  if (!items.length) {
    if (perceive?.main) {
      items.push({
        pri: PRI.DO, kind: 'do',
        text: `环=${perceive.ring}｜主要矛盾=${perceive.main.id}（${Number(perceive.main.strength).toFixed(2)}）${perceive.main.why}\n  ⇒ 先试四种合（升维/降维/换域/重构），合不了才取舍（要写代价+if_wrong）`,
      })
    } else {
      items.push({ pri: PRI.DO, kind: 'do', text: `环=${perceive?.ring || '?'}｜暂无主要矛盾（${perceive?.why || '没给账'}）⇒ 先补账，别凭感觉开工` })
    }
  }

  items.sort((a, b) => a.pri - b.pri)
  const top = items[0]

  const muted = items.slice(1)

  let falsifyNote = null
  if (top.kind === 'do' && falsify?.ok && falsify.shots?.length) {
    falsifyNote = `动手前先想：${falsify.shots.slice(0, 2).map((s) => s.angle).join(' / ')}（${falsify.note}）`
  }

  return {
    verdict: top.kind,
    line: top.text,
    muted,
    falsifyNote,
    brief: [
      `【聚合】${top.text}`,
      ...(muted.length ? [`（压住 ${muted.length} 条：${muted.map((m) => m.kind).join('、')} —— 不是不重要，是现在不该做）`] : []),
      ...(falsifyNote ? [`  ${falsifyNote}`] : []),
    ].join('\n'),
  }
}

export function priName(p) {
  return p === PRI.STOP ? '停' : p === PRI.ASK ? '问' : p === PRI.UNSTICK ? '换层' : '干活'
}
