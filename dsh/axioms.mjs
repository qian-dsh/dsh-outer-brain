
export const AXIOMS = Object.freeze([
  {
    id: 'A1', name: '先建模后写码',
    ask: '动手之前，我有没有把"这件事的结构"写下来（不是脑子里有）？',
    check: (c = {}) => c.hasModel != null
      ? { ok: Boolean(c.hasModel), why: c.hasModel ? '有模型（任务树/里程碑/矛盾树）' : '没有模型就直接写码',
        fix: '先 brain_task + brain_plan（把结构落盘），再动手' }
      : { ok: null, why: '无法判（没有模型信息）', fix: '—' },
  },
  {
    id: 'A2', name: '假设显式化附 if_wrong',
    ask: '这个方案的假设是什么？错了会怎样？',
    check: (c = {}) => {
      if (c.define === undefined) return { ok: null, why: '没给 define 信息 ⇒ 无法判', fix: '—' }
      const df = c.define || {}
      const missing = []
      if (!df.is) missing.push('is（它是什么）')
      if (!df.not) missing.push('not（它不管什么）')
      if (!df.limit) missing.push('limit（什么情况下不成立）')
      return { ok: missing.length === 0, why: missing.length ? `缺：${missing.join('、')}` : '三格齐（is/not/limit）', fix: '补 define；或显式写 state:"blank" + revisit' }
    },
  },
  {
    id: 'A3', name: '六类边界显式定义',
    ask: '这次改动的边界在哪？（管什么、不管什么）',
    check: (c = {}) => {
      const b = c.boundary
      if (!b) return { ok: null, why: '没给 boundary 信息', fix: '—' }
      const need = ['scope', 'outOfScope']
      const miss = need.filter((k) => !String(b[k] || '').trim())
      return { ok: miss.length === 0, why: miss.length ? `缺 ${miss.join('/')}` : '管什么/不管什么都写了', fix: '补 scope 与 outOfScope' }
    },
  },
  {
    id: 'A4', name: '先定验收',
    ask: '做完的时候，我怎么知道成了？（先写下来）',
    check: (c = {}) => {
      if (c.doneWhen === undefined) return { ok: null, why: '没给验收信息 ⇒ 无法判', fix: '—' }
      const w = c.doneWhen || {}
      const ok = Boolean(w.mode) && (w.mode === 'cmd' ? Boolean(w.cmd) : Array.isArray(w.artifacts) && w.artifacts.length > 0)
      return { ok, why: ok ? `验收已定（${w.mode}）` : '没有可执行的验收（先定验收，再动手）', fix: '给 done_when: {mode:"cmd", cmd:"..."}' }
    },
  },
  {
    id: 'A5', name: '一次只改一个子问题',
    ask: '这一轮我是不是同时改了好几件？',
    check: (c = {}) => {
      const n = Number(c.changedCount ?? 0)
      if (!n) return { ok: null, why: '没给改动数', fix: '—' }
      return { ok: n <= 1, why: n <= 1 ? '只改一件' : `这轮改了 ${n} 件 ⇒ 出事分不清是谁的错`, fix: '拆成多轮，一轮一件' }
    },
  },
  {
    id: 'A6', name: '冲突=边界报警器',
    ask: '刚才的冲突/报错，是不是说明边界划错了？',
    check: (c = {}) => {
      const n = Number(c.conflicts ?? 0)
      return n > 0
        ? { ok: false, why: `有 ${n} 条冲突 ⇒ 报警器响了，说明**边界**需要重划（不是"再试一次"）`, fix: '回去重定边界（define/boundary），别在旧边界里硬推' }
        : { ok: true, why: '没有冲突', fix: '—' }
    },
  },
  {
    id: 'A7', name: '矛盾显式化/决策化/平衡化',
    ask: '这条矛盾，写下来了吗？要决定什么？怎么平衡？',
    check: (c = {}) => {
      const open = Number(c.openContra ?? 0)
      const withDecision = Number(c.contraWithDecision ?? 0)
      return open === 0
        ? { ok: true, why: '没有未处理矛盾', fix: '—' }
        : { ok: withDecision >= open, why: `${open} 条未处理，其中 ${withDecision} 条写了"要决定什么"`, fix: '先用 brain_contra 显式化，再写决策（取舍要带代价）' }
    },
  },
  {
    id: 'A8', name: '人工确认门不可跳',
    ask: '这一步需要人点头吗？跳过去了吗？',
    check: (c = {}) => {
      if (!c.needsHumanGate) return { ok: true, why: '这一步不需要人确认', fix: '—' }
      return c.humanConfirmed
        ? { ok: true, why: '人已确认', fix: '—' }
        : { ok: false, why: '**需要人确认但跳过了**（原文 A8：不可跳）', fix: '停下来问（Jev ESCALATE_HUMAN 就是干这个的）' }
    },
  },
  {
    id: 'A9', name: '任何预设流程必须有 Else',
    ask: '这条流程"不成立"的时候走哪？',
    check: (c = {}) => {
      if (c.elsePath === undefined && c.hasFlow === undefined) return { ok: null, why: '没给流程信息 ⇒ 无法判', fix: '—' }
      if (c.hasFlow === false) return { ok: true, why: '这一步没有预设流程 ⇒ 不适用', fix: '—' }
      const hasElse = Boolean(String(c.elsePath || '').trim())
      return { ok: hasElse, why: hasElse ? `有 Else：${String(c.elsePath).slice(0, 40)}` : '**没有 Else**：流程不成立时无处可去', fix: '写清"若这条不成立则走 X"（unknown.reject 也要写理由，同一个道理）' }
    },
  },
  {
    id: 'A10', name: '行动本身创造矛盾',
    ask: '这个动作会新造出什么矛盾？捕获了吗？',
    check: (c = {}) => {
      const captured = Number(c.capturedNew ?? 0)
      const happened = Boolean(c.acted)
      if (!happened) return { ok: null, why: '还没行动', fix: '—' }
      return { ok: captured > 0, why: captured > 0 ? `捕获了 ${captured} 条新矛盾（进未知池）` : '**行动了但没捕获新矛盾** ⇒ 大概率是没看见，不是没有', fix: '用 unknown.capture 把"契约外输出/偏离"落进池' }
    },
  },
])

export function audit(ctx = {}) {
  const rows = AXIOMS.map((a) => ({ id: a.id, name: a.name, ask: a.ask, ...a.check(ctx) }))
  const red = rows.filter((r) => r.ok === false)
  const grey = rows.filter((r) => r.ok === null)
  return {
    rows,
    red,
    grey,
    ok: red.length === 0,
    brief: red.length
      ? `🔴 十条公理自检：${red.length} 条没做到\n${red.map((r) => `  · ${r.id} ${r.name}：${r.why}（${r.fix}）`).join('\n')}`
      : grey.length
        ? `· 十条公理自检：没红（${grey.length} 条无法判）`
        : '· 十条公理自检：全过',
  }
}
