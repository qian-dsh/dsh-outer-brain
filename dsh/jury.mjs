
const NEED = (n) => Math.floor(n / 2) + 1

export const VERDICT = {
  support: 'support',
  insufficient: 'insufficient',
  undecidable: 'undecidable',
}

export const DECISION = {
  pass: 'pass',
  fail: 'fail',
  topped: 'topped',
  hung: 'hung',
  unclear: 'unclear',
  unavailable: 'unavailable',
}

export const BOUNDARY = {
  internal: 'internal',
  independent: 'independent',
  external: 'external',
}

export const ROLES = [
  {
    id: 'fact',
    name: '事实派',
    ask: '只问一件事：这些**硬事实**能不能唯一地推出那句话成立？'
      + '特别注意「证据可换性」：把同一条证据原样拿去证另一件事，会不会也一样通过？'
      + '会 ⇒ 它区分不出真假 ⇒ 判 insufficient。'
      + '判 insufficient 时再问：缺的这环，当事人自己还能造（internal），还是只有外部能给（external）？'
      + '⚠️ 「来源自证」型 claim（要证明"这个脚本 / 这份报告没说谎"）**填 internal，不是 external**：'
      + '它缺的不是外部核验，是**判据形状错** —— 正确出口是把 claim 改写成一条任何人复跑都能判真假的断言'
      + '（例：把被测代码改坏时，这条命令必须非 0）。只有 claim 讲的是**盘外事实**（谁写的 / 外部机构的标注）才填 external。',
  },
  {
    id: 'falsify',
    name: '反方派',
    ask: '你的任务是**推翻它**。具体做法：假设那句话是假的，现在这些硬事实会不会一模一样？'
      + '如果会，判 insufficient，并在 missing 里写出「什么证据才能把它和假的分开」。'
      + '判 insufficient 时再问：你点名的这条证据，是当事人自己就能造，还是它永远造不出来（只能外部给）？'
      + '永远造不出来 ⇒ external（证据到顶了，别再让它补）。找不到反例、也想不出替代解释时，才可以判 support。',
  },
  {
    id: 'gap',
    name: '缺口派',
    ask: '你不判对错，只回答一个问题：还缺哪**一条**能一锤定音的证据？'
      + '想不出缺什么（现有证据已经能定案）⇒ 判 support；'
      + '想得出的 ⇒ 判 insufficient，把那条写进 missing。'
      + '判 insufficient 时再问：这条缺的证据，是当事人自己还能造（internal），还是只有外部能给（external）？'
      + '比如"权威线段标注""第三方复跑"这类 ⇒ external。',
  },
]

const OUTPUT_CONTRACT = [
  '输出**必须**是严格 JSON，一行，不要 markdown 代码块，不要解释，字段只有五个：',
  'verdict 三选一（support / insufficient / undecidable）；',
  'reason ≤60字（说清依据）；missing ≤60字（缺什么，不缺填空串）；',
  'contradiction ≤80字（**claim 与证据的落差**，写成「claim 说 X，但证据只显示 Y」；没有落差填空串。',
  '  这一格是给他看矛盾用的，不是扣分用的）；',
  'boundary 两选一（internal / external）—— **只有这两个合法值，别的字一律算没填**。',
  '结构示例（照结构填，值按你的判断换）：',
  '{"verdict":"insufficient","reason":"证据不足以区分两法","missing":"权威线段标注","boundary":"external"}',
  '三个 verdict 的定义（严格按此判，不许放宽）：',
  '- support      现有硬事实足以推出 claim 成立，且你想不出别的解释',
  '- insufficient 硬事实与 claim 之间缺一环，或存在「证据一样但 claim 为假」的可能',
  '- undecidable  claim 本身含糊到无法判断真伪（这是对判据的指控，不是对证据的）',
  'boundary 只在判 insufficient 时填（其余两态填空串），二选一：',
  '- internal  缺的那一环，当事人自己还能造（补测试 / 补反例 / 写判别用例 / 换一条当场能跑的命令）',
  '- external  缺的那一环，只有外部能给（权威标注 / 第三方独立复跑 / 独立参考实现 / 官方文档 / 别的机器）',
  '⚠️ 「来源自证」类 claim（证明"这脚本 / 这份报告没说谎"）⇒ 填 **internal**：',
  '  它不是"只能外部给"，而是**判据形状错**，出口是把 claim 改写成可被任何人复跑的断言；',
  '  只有 claim 讲的是**盘外事实**（某人写的 / 外部机构的标注）才填 external。',
].join('\n')

export const fmtFacts = (facts) => {
  const f = facts || {}
  const L = []
  if (f.cmd) L.push(`- 机制真跑的命令：${f.cmd}`)
  if (f.expect_exit !== undefined && f.expect_exit !== null) L.push(`- 期望退出码：${f.expect_exit}`)
  if (f.exit !== undefined && f.exit !== null) L.push(`- 实际退出码：${f.exit}`)
  if (f.ms !== undefined && f.ms !== null) L.push(`- 用时：${f.ms}ms`)
  if (f.stdout) L.push(`- 命令输出末尾（机制截取，未经当事人编辑）：\n"""\n${String(f.stdout).slice(-1500)}\n"""`)
  for (const a of (f.artifacts || [])) {
    L.push(`- 文件：${a.path} ${a.exists ? '存在' : '**不存在**'}`
      + (a.size !== undefined ? `，${a.size} 字节` : '')
      + (a.mtime ? `，修改于 ${a.mtime}` : ''))
  }
  for (const a of (f.missing || [])) L.push(`- 缺失：${a}`)
  for (const d of (f.dup_cmd_milestones || [])) {
    L.push(`- ⚠️ 同一条命令已判绿过另一条里程碑 ${d} —— 这条证据可能区分不出两者`)
  }
  const sib = Array.isArray(f.siblings) ? f.siblings : []
  if (sib.length) {
    L.push('- 同任务的其他里程碑（**它们各自的判据已交付什么，都在这儿**）：')
    for (const s of sib.slice(0, 8)) {
      const st = s.status === 'done' ? '✅已绿' : s.status === 'dropped' ? '🗑已弃' : `⬜${s.status}`
      L.push(`  · ${s.id} [${st}] 判据=${String(s.cmd || '（非 cmd）').slice(0, 90)}`)
      if (s.claim) L.push(`      它要证的是：${String(s.claim).slice(0, 70)}`)
    }
    L.push('  ⇒ 若你想要求的东西已由上面某条交付且已绿，**引用它**，不要要求这条重做。')
  }
  return L.length ? L.join('\n') : '（无）'
}

export function buildMaterials({ goal, claim, done_when, facts, declared, history }) {
  const out = [
    '【要证明的那句话（claim）】',
    String(claim || '（空）'),
    '',
    '【它属于哪件事（用户原话 / 任务目标）】',
    String(goal || '（空）'),
    '',
    '【机制规定的判据形态（不是证据，是当初约好的验法）】',
    done_when ? JSON.stringify(done_when) : '（空）',
    '',
    '【硬事实】（机制亲自取得，可以当证据）',
    fmtFacts(facts),
    '',
    '【当事人自述】（未核实。**不许当证据**，只能当"它声称如此"）',
    declared ? String(declared).slice(0, 800) : '（无）',
    '',
  ]

  const hist = Array.isArray(history) ? history.filter(Boolean) : []
  if (hist.length) {
    const tail = hist.slice(-3)
    out.push('【上一轮这个庭要过什么】（**不是证据**，是它自己上次说过的话）')
    tail.forEach((h, k) => {
      const dec = String(h.decision || '?')
      const miss = Array.isArray(h.missing) ? h.missing : (h.missing ? [h.missing] : [])
      const votes = Array.isArray(h.votes) ? h.votes : []
      const bd = votes.map((v) => v.boundary).filter(Boolean)
      out.push(`  第 N-${tail.length - k} 次判决：${dec}`
        + (bd.length ? `（boundary: ${bd.join('/')}）` : '')
        + (miss.length
          ? `，当时点名要的：${miss.slice(0, 3).map((x) => '「' + String(x).slice(0, 50) + '」').join(' ')}`
          : '，当时没点名缺什么'))
    })
    out.push('')
    out.push('⚠️ 如果你这次要的**和上面某一条是同一件事**，请在 reason 里写明"接着上次那条"，不要换个说法重提；')
    out.push('   如果你认为上次那条**已经补上了**，请直接判 support 并在 reason 里点明补上的是哪一条。')
    out.push('')
  }

  out.push(
    '注意：claim 里的"可调""立刻重画""真实数据"这类词，必须由硬事实**直接**支撑。',
    '命令退出 0 只证明命令没报错，不自动等于 claim 成立 —— 除非你能说清退出 0 与 claim 之间的那一跳。',
  )
  return out.join('\n')
}

export function buildRequest(role, mat) {
  const system = [
    `你是一名评审员（${role.name}）。你不参与这件事，不领功劳，也不给鼓励。`,
    '你只能依据给出的材料判断，不许假设材料之外的东西存在。',
    role.ask,
    '',
    OUTPUT_CONTRACT,
  ].join('\n')
  return { system, user: mat }
}

export function parseVerdict(text) {
  const raw = String(text ?? '')
  const s = raw.indexOf('{')
  const e = raw.lastIndexOf('}')
  if (s < 0 || e <= s) return { verdict: VERDICT.undecidable, reason: '输出不是 JSON（无法定案）', missing: '', parse_failed: true }
  let o
  try { o = JSON.parse(raw.slice(s, e + 1)) } catch { return { verdict: VERDICT.undecidable, reason: 'JSON 解析失败（无法定案）', missing: '', parse_failed: true } }
  let v = String(o.verdict ?? '').trim().toLowerCase()
  if (v === 'support' || v === 'pass' || v === '支持') v = VERDICT.support
  else if (v === 'insufficient' || v === 'fail' || v === '不足' || v === 'insufficient_evidence') v = VERDICT.insufficient
  else v = VERDICT.undecidable
  let b = String(o.boundary ?? '').trim().toLowerCase()
  b = (b === BOUNDARY.internal || b === BOUNDARY.independent || b === BOUNDARY.external) ? b : null
  if (b === null) {
    const miss = String(o.missing ?? '')
    const EXT = /第三方|独立(于)|权威|外部(评审|基准|复核|重算|复算|重跑)|他处|干净环境|换一台|另一台|别的机器|会话外|不由我控制|由人(工)?(核|确)|TSA|时间戳机构|托管记录|公证|git\s*log|机制(亲自|自行|自己)|由机制|宿主(可达|亲自)|真机挂载|非脚本自|非自写/
    const INDEP = /独立(复跑|复算|重跑|重算|实现|验证|复盘)|第二套实现|另一套实现|自己再写一遍|换个法子算/
if (EXT.test(miss)) b = BOUNDARY.external
else if (INDEP.test(miss)) b = BOUNDARY.independent
    else if (miss.trim()) b = BOUNDARY.internal
  }
  return {
    verdict: v,
    reason: String(o.reason ?? '').slice(0, 200),
    missing: String(o.missing ?? '').slice(0, 200),
    contradiction: String(o.contradiction ?? '').slice(0, 300),
    boundary: b,
    parse_failed: false,
  }
}

export function tally(votes) {
  const all = Array.isArray(votes) ? votes.filter(Boolean) : []
  const KNOWN = [VERDICT.support, VERDICT.insufficient, VERDICT.undecidable]
  const vs = all.filter((v) => KNOWN.includes(v.verdict))
  const broken = all.length - vs.length
  const n = vs.length
  const c = (k) => vs.filter((v) => v.verdict === k).length
  const support = c(VERDICT.support)
  const insufficient = c(VERDICT.insufficient)
  const undecidable = c(VERDICT.undecidable)
  const need = NEED(n)
  const external = vs.filter((v) => v.verdict === VERDICT.insufficient && v.boundary === BOUNDARY.external).length
  const missing = [...new Set(vs.map((v) => String(v.missing || '').trim()).filter(Boolean))]
  const OVERREACH = /(单跑|换跑|另跑|补跑|再跑.{0,6}一次|换一条命令|另一个参数|--only=|--verbose|单独执行)/
  const missing_kind = missing.map((m) => (OVERREACH.test(m) ? 'overreach' : 'fillable'))
  const overreach_n = missing_kind.filter((k) => k === 'overreach').length
  const overreached = missing.length > 0 && overreach_n * 2 >= missing.length
  const gaps = [...new Set(vs.map((v) => String(v.contradiction || '').trim()).filter(Boolean))]
  const gapsOut = gaps.length ? gaps : []
  const dissent = vs.filter((v) => v.verdict !== VERDICT.support)
    .map((v) => `${v.role || '?'}：${v.reason || v.verdict}`)

  let decision
  if (n === 0) decision = DECISION.unavailable
  else if (support >= need) decision = DECISION.pass
  else if (insufficient >= need && external >= need) decision = DECISION.topped
  else if (insufficient >= need) decision = DECISION.fail
  else if (undecidable >= need) decision = DECISION.unclear
  else if (broken > 0) decision = DECISION.unavailable
  else decision = DECISION.hung

  const why = decision === DECISION.pass
    ? `${support}/${n} 判支持`
    : decision === DECISION.fail
      ? `${insufficient}/${n} 判证据不足（还能补）`
      : decision === DECISION.topped
        ? `${external}/${n} 判证据到顶（缺的只有外部能给）`
        : decision === DECISION.unclear
          ? `${undecidable}/${n} 判判据含糊`
          : decision === DECISION.hung
            ? `无多数（支持${support} 不足${insufficient} 判不了${undecidable}）`
            : '未开成庭'

  return {
    decision, why,
    n, support, insufficient, undecidable, external,
    unanimous: decision === DECISION.pass && support === n,
    missing, dissent,
    missing_kind,
    overreached,
    gaps: gapsOut,
    votes: vs.map((v) => ({ role: v.role, verdict: v.verdict, reason: v.reason, missing: v.missing,
      contradiction: v.contradiction || '',
      boundary: v.boundary || null, parse_failed: !!v.parse_failed })),
  }
}

export function juryRecord(t, extra = {}) {
  return {
    at: new Date().toISOString(),
    decision: t.decision, why: t.why,
    n: t.n, support: t.support, insufficient: t.insufficient, undecidable: t.undecidable,
    external: t.external ?? 0,
    unanimous: !!t.unanimous,
    missing: t.missing || [],
    gaps: t.gaps || [],
    dissent: t.dissent || [],
    votes: t.votes || [],
    ...extra,
  }
}

const ICON = {
  [DECISION.pass]: '✅',
  [DECISION.fail]: '❌',
  [DECISION.topped]: '🚧',
  [DECISION.hung]: '⚠️',
  [DECISION.unclear]: '❓',
  [DECISION.unavailable]: '🔴',
}

export function juryLine(rec) {
  if (!rec) return ''
  const ic = ICON[rec.decision] || '·'
  const head = rec.decision === DECISION.unavailable
    ? '🔴 陪审未开成庭'
    : `${ic} 陪审 ${rec.why}`
  if (rec.decision === DECISION.pass) {
    const majority = rec.support >= (rec.insufficient ?? 0)
      && rec.support >= (rec.undecidable ?? 0) ? 'support'
      : (rec.insufficient ?? 0) >= (rec.undecidable ?? 0) ? 'insufficient' : 'undecidable'
    const fromVotes = Array.isArray(rec.votes)
      ? rec.votes
        .filter((v) => v && v.verdict && v.verdict !== majority)
        .map((v) => `${v.role || v.id || '评审'}：${String(v.reason || v.why || '').slice(0, 90)}`)
        .filter((s) => s.length > 4)
      : []
    const dis = Array.isArray(rec.dissent) ? rec.dissent : fromVotes
    if (dis.length) return `${head}；少数派：${dis.join('；')}`
    if (rec.unanimous === true) return `${head}（一致）`
    return `${head}（少数派记录缺失：votes 里也没有反对票）`
  }
  const tail = rec.decision === DECISION.unclear
    ? '⇒ **判据本身含糊，改写 done_when**（补证据没用）'
    : rec.decision === DECISION.topped
      ? `⇒ **证据到顶**：缺的只有外部能给（${(rec.missing || []).join(' / ') || '陪审未点名外部条件'}）`
        + '——不是"再补一件"，是"接不可达（缺外部条件）"'
      : rec.decision === DECISION.unavailable
        ? `⇒ **本条未经陪审复核**（${rec.why_unavailable || '未开成庭'}）——交付不挡，抓错悬空待补审`
        : `⇒ 缺：${(rec.missing || []).join(' / ') || '（陪审未给出缺项）'}`
  return `${head} ${tail}`
}

export function dupCmdHits(plan, id) {
  const m = plan?.milestones?.[String(id)]
  const cmd = m?.done_when?.cmd
  if (!cmd) return []
  return Object.values(plan.milestones || {})
    .filter((x) => String(x.id) !== String(id) && x.status === 'done' && x.done_when?.cmd === cmd)
    .map((x) => String(x.id))
}
