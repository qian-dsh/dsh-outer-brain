
import { REVISIT_KIND as REVISIT_KINDS } from './take.mjs'

export const LIFT_WAY = {
  ladder: {
    name: '抽象阶梯',
    from: 'abstraction laddering / why-how laddering（设计思维、Lean 里的常用工具）',
    ask: '上一问：这条约束是为了什么？下一问：所以具体要成什么样？两头一对，原矛盾常常在某一头消失',
    kills: '「这个做不到」→ 发现要做到的是上层那个目标，下层这个做法本来就不是唯一解',
  },
  restate: {
    name: '问题重构',
    from: 'problem restatement / CPS（Osborn-Parnes 创造性问题解决的第一步）',
    ask: '把「X 不行」改写成「X 在什么条件下才行」；或「不是 X 不行，是我把 Y 当成了 X」',
    kills: '「判据和事实对不上」→ 发现是判据把两件事当成了一件（M1/M2 同命令判绿就是这个）',
  },
  separate: {
    name: '矛盾分离',
    from: 'TRIZ 分离原理（时间分离 / 空间分离 / 条件分离 / 整体部分分离）',
    ask: '两个互斥的要求，能不能不在同一时刻、不在同一对象、不在同一条件下成立？',
    kills: '「既要稳又要快」→ 发现稳是对上线后的要求，快是对开发期；矛盾是同一句里放了两段时间',
  },
  counter: {
    name: '反例构造',
    from: '最小反例法（数学、逻辑、属性测试的 shrinking）',
    ask: '构造一个具体例子，让两条判据同时为真、结论却相反 ⇒ 冲突在层，不在事',
    kills: '「两条规则打架」→ 举出一个同时满足两者却荒谬的例子，立刻看出该给哪条加条件',
  },
}

export const LIFT_SOURCE = {
  precedent: '借已有的先例（谁做过/哪份文档/哪段代码，给名字或路径）',
  user: '借用户自己的话（给原话里的关键词）',
  evidence: '借盘上已有的证据（给 rid）',
  search: '这次真去外面查了（给查询词 + 查到了什么）',
}

const AIR = /^(我感觉|我觉得|我猜|凭感觉|凭直觉|直觉|我自己想的|凭空|想出来的|经验告诉我|常识|一般来说|from\s*air|air\b)/i

export function checkLift(v) {
  const o = v || {}
  const way = String(o.way ?? '').trim()

  if (o.blank === true || String(o.state || '') === 'blank') {
    const why = String(o.why ?? '').trim()
    const rv = o.revisit || {}
    if (why.length < 6) {
      return { ok: false, grade: 'blank', why: `升维留空要写 why（为什么现在想不出怎么升，≥6 字）—— 当前「${why}」` }
    }
    if (!rv.kind || !rv.at || !Object.keys(REVISIT_KINDS).includes(String(rv.kind))) {
      return {
        ok: false, grade: 'blank',
        why: `升维留空要挂 revisit（kind 只能取 ${Object.keys(REVISIT_KINDS).join(' / ')} + at）`
          + ' —— 空着可以，但要有一个机制能等的触发，'
          + '否则这次空着永远不会被想起来（"没探索过的地方留空"不是"忘掉它"）',
      }
    }
    return { ok: true, grade: 'blank', note: `升空中（等 ${rv.kind}:${rv.at}）：${why}` }
  }

  if (!LIFT_WAY[way]) {
    const keys = Object.keys(LIFT_WAY).join(' / ')
    return {
      ok: false, grade: 'none',
      why: `没说清用哪种手段（拿到「${way || '空'}」）。可选：${keys}。`
        + '四选一都行，也可以 `blank:true` 说"这次想不出怎么升"—— 但"多写一个变量"不在这张表里，'
        + '它只是在同一层加项，不是升维（旧 LIFT 判据就是这么被绕过的）。',
    }
  }

  const cov = o.covers || {}
  const covOld = Array.isArray(cov.oldVariables) ? cov.oldVariables.map(String).filter(Boolean) : []
  const covNew = Array.isArray(cov.claimVariables) ? cov.claimVariables.map(String).filter(Boolean) : []
  const topOld = Array.isArray(o.oldVariables) ? o.oldVariables.map(String).filter(Boolean) : []
  const topNew = Array.isArray(o.claimVariables) ? o.claimVariables.map(String).filter(Boolean) : []
  const oldVars = covOld.length ? covOld : topOld
  const newVars = covNew.length ? covNew : topNew
  const c1Source = (covOld.length || covNew.length) ? 'covers' : ((topOld.length || topNew.length) ? 'top-level' : 'absent')

  if (oldVars.length && newVars.length) {
    const lost = oldVars.filter((v) => !newVars.includes(v))
    if (lost.length) {
      return {
        ok: false, grade: 'none',
        why: `条件①（B ⊂ B') 不成立：旧层的变量 ${lost.join(', ')} 在新层里消失了 —— `
          + '那不是升维，是换了一个不相干的层（新层必须覆盖旧层的所有状态，否则旧矛盾只是被甩掉了）。',
      }
    }
  }

  const kills = String(o.kills ?? '').trim()
  if (kills.length < 6) {
    return {
      ok: false, grade: 'none',
      why: '条件②（Φ\'|ι(B) = 0）没交代：**说不出哪条旧矛盾在新层下不成立了** —— '
        + '这条是升维的定义本身，不是附加要求。旧判据「new_vars ≠ ∅」只证"多了一项"，不证"换了层"，'
        + '所以它填一堆新变量名、旧矛盾一条没消，仍然算"取"。\n'
        + '  ⇒ 请在 kills 里点名：哪条旧矛盾（id 或原文关键词）、在新层的什么说法下不成立了。\n'
        + '  说不出 ⇒ 这次不是升维，是换了个说法（执）。',
    }
  }

  const newContra = String(o.new_contra ?? '').trim()
  if (newContra.length < 10) {
    return {
      ok: false, grade: 'none',
      why: '条件③（Φ\' ≠ 0）没交代：**新层自己产生的矛盾是什么**（≥10 字）。\n'
        + '  取即有边界，边界即矛盾 —— 说不出新层的矛盾，说明这次"取"没真发生'
        + '（你只是把旧矛盾搬到了更高的地方，却当它解决了）。',
    }
  }
  const src = o.source || {}
  const kind = String(src.kind ?? '').trim()
  const at = String(src.at ?? '').trim()

  if (!kind) {
    return {
      ok: true, grade: 'fromAir', way,
      condition1: c1Source === 'absent' ? 'unjudged' : 'judged',
      three_conditions: { contains_old: c1Source === 'absent' ? null : true, kills: kills.slice(0, 120), new_contra: newContra.slice(0, 120) },
      note: `用了「${LIFT_WAY[way].name}」，但没说从哪借 ⇒ 记为从空中取。`
        + `（消掉旧矛盾「${kills.slice(0, 40)}」；新层矛盾「${newContra.slice(0, 40)}」）`
        + '允许，但后面有证据撞到它时，先怀疑这一条（借过的借据可以被推翻，空中取的无从核对）。',
    }
  }
  if (!LIFT_SOURCE[kind]) {
    return { ok: false, grade: 'none', why: `source.kind「${kind}」不认识。可选：${Object.keys(LIFT_SOURCE).join(' / ')}` }
  }
  if (!at) {
    return { ok: false, grade: 'none', why: `source.kind=${kind} 但没给 at（${LIFT_SOURCE[kind]}）` }
  }
  if (kind !== 'search' && AIR.test(at)) {
    return {
      ok: true, grade: 'fromAir', way,
      condition1: c1Source === 'absent' ? 'unjudged' : 'judged',
      note: `source.at「${at}」是"我凭感觉"的另一种说法 ⇒ 记为从空中取（不是借）。`,
    }
  }
  return {
    ok: true, grade: 'borrowed', way,
    condition1: c1Source === 'absent' ? 'unjudged' : 'judged',
    source: { kind, at, got: String(src.got ?? '').trim() },
    note: `借自 ${kind}:${at}`,
  }
}

export function liftTag(r) {
  if (!r || !r.grade || r.grade === 'none') return ''
  if (r.grade === 'blank') return '〔升维:空〕'
  if (r.grade === 'fromAir') return `〔升维:${LIFT_WAY[r.way]?.name || r.way}·空中取〕`
  return `〔升维:${LIFT_WAY[r.way]?.name || r.way}·借自${r.source?.kind || '?'}〕`
}

export function wayMenu() {
  return Object.entries(LIFT_WAY).map(([k, v]) => `${k}=${v.name}`).join(' / ')
}
