
export const LAYER = Object.freeze({
  IMPL: 'impl',
  CONTRACT: 'contract',
  ASSUMPTION: 'assumption',
  OTHER: '其它',
})

export const ESCAPE = Object.freeze([
  { kind: '换域', how: '换一个判据空间（命令→产物 / 自检→使用者动作 / 代码→读数）' },
  { kind: '反演', how: '把命题反过来问：如果它必须为假，需要什么条件？' },
  { kind: '升维', how: '换一层，把旧命题包含进来（`brain_lift_check`）' },
  { kind: '外部锚点', how: '找一个盘外事实/权威读数，不再在自己造的循环里验证' },
])

export function layerOf(target = '') {
  const t = String(target || '').toLowerCase()
  if (!t) return LAYER.OTHER
  if (/(^|[\\/])(assumptions|preset|预设)/.test(t) || /\.md$/.test(t) && /assump|预设|假设/.test(t)) return LAYER.ASSUMPTION
  if (/(^|[\\/])check-|\.spec\.|contract|done_when|conftest/.test(t)) return LAYER.CONTRACT
  if (/\.(js|mjs|cjs|ts|tsx|jsx|py|css|json)$/.test(t)) return LAYER.IMPL
  if (/\.md$/.test(t)) return LAYER.ASSUMPTION
  return LAYER.OTHER
}

export function detect(steps = [], opt = {}) {
  const win = Math.max(3, Number(opt.window ?? 8))
  const minReps = Math.max(2, Number(opt.minReps ?? 3))
  const stopAt = Math.max(2, Number(opt.stopAt ?? 3))
  const recent = (Array.isArray(steps) ? steps : []).slice(-win)

  const cnt = new Map()
  for (const s of recent) {
    const t = String(s?.target || '').trim()
    if (!t) continue
    cnt.set(t, (cnt.get(t) || 0) + 1)
  }
  let topTarget = ''
  let topN = 0
  for (const [t, n] of cnt) if (n > topN) { topN = n; topTarget = t }

  const repeating = topN >= minReps
  const layer = layerOf(topTarget)
  const tail = recent.slice(-stopAt)
  const layers = new Set(tail.map((s) => layerOf(s?.target)))
  const sameLayer = layers.size === 1

  let streak = 0
  for (let i = recent.length - 1; i >= 0; i--) {
    if (String(recent[i]?.target || '') === topTarget) streak++
    else break
  }

  const mustStop = repeating && sameLayer && streak >= stopAt
  const escape = mustStop ? pickEscape(layer) : []

  return {
    repeating, sameLayer, layer, target: topTarget, reps: topN, streak, mustStop, escape,
    report: mustStop
      ? `🔴 打转：同一目标「${topTarget}」在第 ${layer} 层重复 ${topReps(topN)}（连续 ${streak} 步）`
        + ` ⇒ **强制暂停，别再试同一招**。逃逸动作：${escape.map((e) => e.kind).join(' / ')}`
      : repeating
        ? `🟠 有重复倾向：「${topTarget}」出现 ${topN} 次，但层不一致或未连续 ⇒ 暂不暂停`
        : '',
  }
}

function pickEscape(layer) {
  if (layer === LAYER.IMPL) {
    return [
      { kind: '升契约层', how: '改不动实现 ⇒ 说明**判据/契约**没定清楚，先回去把"什么算对"写死' },
      ESCAPE[0], ESCAPE[3],
    ]
  }
  if (layer === LAYER.CONTRACT) {
    return [
      { kind: '回假设层', how: '判据改了还不行 ⇒ 说明**前提**错了（这条需求本身可能不成立）' },
      ESCAPE[1], ESCAPE[2],
    ]
  }
  if (layer === LAYER.ASSUMPTION) {
    return [
      { kind: '外部锚点', how: '假设反复改 ⇒ 自己在循环里验证不算数，找一个盘外事实' },
      ESCAPE[2], ESCAPE[0],
    ]
  }
  return ESCAPE.slice(0, 2)
}

const topReps = (n) => `${n} 次`

export function brief(res) {
  return res && res.mustStop ? res.report : null
}
