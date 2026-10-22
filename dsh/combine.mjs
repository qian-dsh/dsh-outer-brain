
export const COMBINE = Object.freeze([
  {
    kind: '升维',
    how: '换一层：把"X 不行"变成"X 在什么条件下才行"，新层要**包含**旧命题（不是替换）',
    done: '新层给出了一个旧层无法回答、新层能回答的问题；且旧矛盾在新层里不再是矛盾',
    tool: 'brain_lift_check（way+source）',
  },
  {
    kind: '降维',
    how: '拆成两块**互不重叠**的子问题，各管一半边界',
    done: '两块各自的边界写清；合起来正好覆盖原范围（不漏、不叠）',
    tool: 'brain_contra act:"降维"（split + why_orthogonal）',
  },
  {
    kind: '换域',
    how: '换一个判据空间：命令→产物、自检→使用者动作、代码→读数',
    done: '在新域里这条矛盾消失或变小；且新域的证据仍然可核',
    tool: '（人工选域，无需工具）',
  },
  {
    kind: '重构',
    how: '把"X 不行"改写成"X 在什么条件下才行"（问题重构，不换层）',
    done: '改写后的命题可判真假，且原命题是它的一个特例',
    tool: 'brain_contra act:"重定义"（was/now/why）',
  },
])

export function combineFirst(contra = {}) {
  const s = Number(contra.strength ?? 0)
  const high = s >= 0.7
  return {
    ok: true,
    contra: { id: contra.id || '(未命名)', a: contra.a || '', b: contra.b || '', strength: s, why: contra.why || '' },
    high,
    note: high
      ? '这条矛盾影响高（≥0.70）⇒ **必须先试完下面四种合**，合不了才允许取舍'
      : '影响一般（<0.70）⇒ 可以只试一种合，或直接进取舍（但要写代价）',
    ways: COMBINE.map((w) => ({ ...w })),
    then: '四种合都试过且都不成立 ⇒ 才调 `thenSplit()`；它会强制要"让给谁 + 代价 + if_wrong"',
  }
}

export function thenSplit(contra = {}, { tried = [], yieldTo = '', cost = '', ifWrong = '' } = {}) {
  if (!Array.isArray(tried) || tried.length < 1) {
    return { ok: false, why: '先写清"试过哪些合、怎么不成立的"（tried）—— 没试过就分 = 选省力的那条' }
  }
  if (!String(yieldTo || '').trim()) return { ok: false, why: '要让给谁？（yieldTo）—— 不指明就是"两边都想要"' }
  if (!String(cost || '').trim()) return { ok: false, why: '代价是什么？（cost）—— 说不清代价的取舍不是取舍' }
  if (!String(ifWrong || '').trim()) return { ok: false, why: 'if_wrong 呢？（这个取舍错了会怎样）—— 原文 A2 要求显式' }
  return {
    ok: true,
    kind: '取舍',
    tried,
    yieldTo: String(yieldTo),
    cost: String(cost),
    ifWrong: String(ifWrong),
    record: `取舍：把「${contra.id || '这条矛盾'}」让给「${yieldTo}」，代价是「${cost}」；若错了会是「${ifWrong}」（试过：${tried.join('、')}）`,
  }
}
