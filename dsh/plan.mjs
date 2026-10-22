
import * as TK from './take.mjs'

export const PLAN_STATUS = ['pending', 'done', 'failed', 'dropped', 'blocked']

export const DONE_MODE = {
  cmd: 'cmd',
  evidence: 'evidence',
  pair: 'pair',
}

export const FORBIDDEN_MODES = ['self', 'manual', 'agent', 'trust']

export const DEFINE_Q = {
  is: '它成了的时候是什么样（一句话；拿一个具体例子能判是/不是）',
  not: '它**不管**什么（边界：哪些情况出现了也不算它成）',
  limit: '什么情况下这个定义本身不成立、要重定义（可推翻条件）',
}

export function normDef(s) {
  return String(s || '').replace(/[\s，。；、：:,.!?！？"'“”‘’()（）【】\[\]—…\-~～/\\|]/g, '')
}

const NARROW_MARK = /不管|不是|不包括|不含|不涉及|不负责|不保证|不处理|不覆盖|不算|≠|只限|仅限/

export function isParaphrase(text, cand) {
  const nt = normDef(text)
  const nc = normDef(cand)
  if (!nc) return true
  if (nc === nt) return true
  if (nt.includes(nc) && nc.length >= nt.length * 0.85) return true
  if (nt.length >= 6 && nc.includes(nt) && nc.split(nt).join('').length < 5) return true
  return false
}

export function checkDefine(id, text, df) {
  const d = df || {}
  const is = String(d.is ?? '').trim()
  const not = String(d.not ?? '').trim()
  const limit = String(d.limit ?? '').trim()
  const missing = []
  if (!is) missing.push('is（它是什么）')
  if (!not) missing.push('not（它不管什么）')
  if (!limit) missing.push('limit（什么情况下这个定义不成立）')
  if (missing.length) {
    return { ok: false, why: `里程碑 ${id} 缺 define.${missing.join(' / define.')} —— `
      + '提交之前先把这件事定义清楚：没有定义，判据就无处附着，只能附着在"跑了同一段代码"上'
      + '（真机 M1/M2 就是这么用一条命令判绿两件不同的事的）' }
  }

  const nt = normDef(text)
  const ni = normDef(is)
  if (ni.length < 6) {
    return { ok: false, why: `里程碑 ${id} 的 define.is 太短（规范化后 ${ni.length} 字）—— `
      + '「可调」「优化好」这类词判不出是/不是，不是定义' }
  }
  if (ni === nt) {
    return { ok: false, why: `里程碑 ${id} 的 define.is 与 text 一模一样（去掉标点后）—— `
      + '复述不是定义。定义要回答的是**原话里含混的那部分**：成的时候看到的是什么？哪几种情况不算？' }
  }
  if (nt.length >= 8 && nt.includes(ni) && ni.length >= nt.length * 0.85) {
    return { ok: false, why: `里程碑 ${id} 的 define.is 只是 text 的截取（${ni.length}/${nt.length} 字）—— `
      + '定义必须比原话更窄或更具体，不能只是少抄几个字' }
  }
  if (isParaphrase(text, is)) {
    return { ok: false, why: `里程碑 ${id} 的 define.is 只是把 text 抄了一遍再加几个字（${ni.length}/${nt.length} 字）—— `
      + '多出来的那几个字是语气，不是界定。定义要能回答"哪几种情况出现了**不算**它成"' }
  }
  if (!NARROW_MARK.test(not)) {
    return { ok: false, why: `里程碑 ${id} 的 define.not 里没有任何收窄/否定（"不管/不是/不包括/只限…"）—— `
      + `它看不出边界在哪，读起来更像把 is 又写了一遍。当前值：「${not.slice(0, 40)}」` }
  }
  if (limit.length < 6) {
    return { ok: false, why: `里程碑 ${id} 的 define.limit 太短（${limit.length} 字）—— `
      + '要给一个**能被现实撞到**的失效条件，否则这条定义永远不会被推翻，也就永远不会被修' }
  }

  const CLAIM_WORDS = ['一致', '相等', '相同', '全等', '一致', '递增', '递减', '相差', '小于', '大于', '等于',
    '为真', '通过', '命中', '包含', '存在', '成立', '满足', '收敛']
  let defineWarn = ''
  for (const w of CLAIM_WORDS) {
    if (!is.includes(w)) continue
    let from = 0
    for (;;) {
      const at = not.indexOf(w, from)
      if (at < 0) break
      const before = not.slice(Math.max(0, at - 3), at)
      if (/[未不没无非否别]|不管|不是|不算|不计|只限/.test(before)) {
        defineWarn = `is 断言「${w}」，而 not 里写了「…${before}${w}」——`
          + ' 若这两处指的是同一件事，这条定义就是空集（永远满足不了，也永远证不伪）；'
          + ' 若指的是两件事，请把措辞改得分得开。'
        break
      }
      from = at + 1
    }
    if (defineWarn) break
  }

  return { ok: true, define: { is, not, limit }, ...(defineWarn ? { define_warn: defineWarn } : {}) }
}

export function checkTaskReading(id, text, { reading, because, want } = {}) {
  const r = String(reading ?? '').trim()
  const b = String(because ?? '').trim()
  const w = String(want ?? '').trim()
  const miss = []
  if (!r) miss.push('reading（你怎么理解这条要求 —— 你的判断，不是用户的话）')
  if (!b) miss.push('because（为什么要这样做/这个范围/现在）')
  if (!w) miss.push('want（看到什么才算这条满足了）')
  if (miss.length) {
    return { ok: false, why: `声明任务 ${id} 之前先答三问，缺：${miss.join(' / ')}。`
      + '这三问不是形式：没有 reading，"用户的话"和"你以为用户要的"就混成一条账（漂移从这里开始）；'
      + '没有 want，后面拆出来的里程碑没有落点，往往会落到"跑通了某个脚本"上。'
      + '边界：只要求你自己判断，不要求判断正确 —— 写错了进矩阵，有新证据就降置信度。' }
  }
  const nt = normDef(text)
  const nr = normDef(r)
  if (isParaphrase(text, r)) {
    return { ok: false, why: `任务 ${id} 的 reading 是把 text 重说了一遍（规范化后 ${nr.length}/${nt.length} 字）—— `
      + '复述不是理解。要写出你从原话里读出来的那个东西：它要什么、不要什么、成的时候是什么样。'
      + '你写的是取，会错；但空着或复述，连错的资格都没有。' }
  }
  if (b.length < 6) {
    return { ok: false, why: `任务 ${id} 的 because 太短（${b.length} 字）—— `
      + '要答"为什么是这个范围、为什么是现在"，不是"因为用户让做"（那是没判断）' }
  }
  if (w.length < 6) {
    return { ok: false, why: `任务 ${id} 的 want 太短（${w.length} 字）—— `
      + '要给一个能验证的落点（看到什么、拿到什么）' }
  }
  return { ok: true, reading: r, because: b, want: w }
}

const now = () => new Date().toISOString()

export function newPlan() {
  return { milestones: {}, revision: 0, created_at: now(), updated_at: now() }
}

export function checkMilestone(plan, m, opt = {}) {
  const id = String(m?.id || '').trim()
  {
    const prevM = plan?.milestones?.[id] || null
    if (prevM) {
      const given = Object.fromEntries(Object.entries(m || {}).filter(([, v]) => v !== undefined && v !== ''))
      m = { ...prevM, ...given }
    }
  }
  if (!id) return { ok: false, why: '里程碑缺 id' }
  if (!plan?.tasks || !plan.tasks[String(m.task || '')]) {
    return { ok: false, why: `里程碑 ${id} 的 task=${m.task || '（空）'} 不存在 —— 里程碑必须挂用户任务，不许悬空`
      + '（悬空的里程碑 = 机制自己派的活，正是要治的病）' }
  }
  const text = String(m.text || '').trim()
  if (!text) return { ok: false, why: `里程碑 ${id} 缺 text（这一步到底要成什么）` }
  const taskNode = plan.tasks?.[String(m.task)]
  const taskText = String(taskNode?.text ?? '').trim()
  if (taskText && isParaphrase(taskText, text)) {
    return { ok: false, why: `里程碑 ${id} 的 text 是任务 ${m.task} 原话的复述——`
      + '这是「执」不是「取」：向（任务）没被拆下来，只是被重复了一遍。'
      + '里程碑要回答「这一步要**成什么**」，必须比任务更具体、更窄（一次取，下一条边界），'
      + '不是把用户的话再说一遍。出口：写这一步的可交付结果（文件/命令/可核的数对应的那件事实）。'
      + `任务原话：「${taskText.slice(0, 60)}」` }
  }
  const wantText = String(taskNode?.want ?? '').trim()
  if (wantText && isParaphrase(wantText, text)) {
    return { ok: false, why: `里程碑 ${id} 的 text 复述了任务 ${m.task} 的 want（你要的结果）——`
      + '「想要的结果」和「这一步要成什么」是两层，抄一遍等于没降维。'
      + 'want 是向的落点，里程碑是把它拆下来的第一刀，必须比 want 更窄、更具体。'
      + `任务 want：「${wantText.slice(0, 60)}」` }
  }
  const readingText = String(taskNode?.reading ?? '').trim()
  if (readingText && isParaphrase(readingText, text)) {
    return { ok: false, why: `里程碑 ${id} 的 text 复述了任务 ${m.task} 的 reading（你的理解）——`
      + '「理解」和「拆成一步」是两层，抄一遍等于没拆。'
      + '里程碑要写「这一步可交付的结果」，不是把你的理解再说一遍。'
      + `任务 reading：「${readingText.slice(0, 60)}」` }
  }
  const isRedef = String(m.define?.state ?? '') === 'redef'
  if (!isRedef) {
    for (const s of Object.values(plan.milestones || {})) {
      if (s.id === id || s.task !== String(m.task)) continue
      const stext = String(s.text ?? '').trim()
      if (stext && (isParaphrase(stext, text) || isParaphrase(text, stext))) {
        return { ok: false, why: `里程碑 ${id} 的 text 与同任务里程碑 ${s.id} 复述——`
          + '同一个向被切成两个同名（切碎稀释难度）。'
          + '两条里程碑要分得开：要么是向的不同段，要么合并成一条，别用两条抄一遍的话凑进度。'
          + `已有 ${s.id}：「${stext.slice(0, 40)}」；本条：「${text.slice(0, 40)}」` }
      }
    }
  }
  const output = String(m.output || '').trim()
  if (!output) {
    return { ok: false, why: `里程碑 ${id} 缺 output（交付物）—— `
      + '没有交付物的里程碑不是里程碑，是感想。给具体的东西：文件路径 / 命令 / URL / 可核的数' }
  }
  const dw = m.done_when || {}
  const mode = String(dw.mode || '').trim()
  const sibsOfTask = Object.values(plan.milestones || {}).filter((x) => x.task === String(m.task))
  const isFirst = sibsOfTask.length === 0
  const needDefine = m.critical === true || isFirst
  const gaveDefine = !!(m.define && (m.define.is || m.define.not || m.define.limit
    || m.define.state || m.define.blank || m.define.redef || m.define.why || m.define.was))
  let takeRes = { state: 'none', factor: 0, why: '', take: null }
  let defineWarnOut = ''
  if (needDefine || gaveDefine) {
    const tchk = TK.checkTake(['is', 'not', 'limit'], m.define, { exists: opt.exists || null })
    takeRes = { state: tchk.state, factor: tchk.factor, why: tchk.why || '', take: tchk.take || null, half: !!tchk.half }
    if (!tchk.ok) {
      return { ok: false, why: tchk.why, take: null, threeWays: true }
    }
    if (tchk.state === 'given') {
      const dchk = checkDefine(id, text, m.define)
      defineWarnOut = dchk.define_warn || ''
      if (!dchk.ok) {
        return {
          ok: false,
          why: `${dchk.why}\n\n（三条出路选一条：① 补齐这三问；`
            + '② 改成 `define.state:"blank"` + why + scope + revisit —— 现在给不出就诚实留空，机制会挂到期；'
            + '③ 改成 `define.state:"redef"` + was/now/why —— 如果你认为这件事的表述本身该换）',
          threeWays: true,
        }
      }
    }
  }  if (FORBIDDEN_MODES.includes(mode)) {
    return { ok: false, why: `里程碑 ${id} 的 done_when.mode="${mode}" 被拒 —— `
      + '「自己说自己做完」不是判据，是幻觉的唯一入口。'
      + `只收两种：${DONE_MODE.cmd}（机制跑命令，看退出码）/ ${DONE_MODE.evidence}（给证据路径，机制验存在）` }
  }
  if (mode === DONE_MODE.cmd) {
    const cmd = String(dw.cmd || '').trim()
    if (!cmd) return { ok: false, why: `里程碑 ${id} 声明 mode=cmd 但没给 cmd —— 判据不可执行` }
    const exit = dw.expect_exit === undefined ? 0 : Number(dw.expect_exit)
    if (!Number.isInteger(exit)) return { ok: false, why: `里程碑 ${id} 的 expect_exit 必须是整数（拿到 ${dw.expect_exit}）` }
  } else if (mode === DONE_MODE.pair) {
    const cmd = String(dw.cmd || '').trim()
    if (!cmd) return { ok: false, why: `里程碑 ${id} 声明 mode=pair 但没给 cmd —— 判据不可执行` }
    const mp = String(dw.mutatePath || '').trim()
    if (!mp) {
      return { ok: false, why: `里程碑 ${id} 声明 mode=pair 但没给 mutatePath（把哪个字段改坏）—— `
        + '没有改坏点就没有翻红对照，那还是 cmd' }
    }
    const cp = String(dw.claimPath || mp).trim()
    if (cp !== mp) {
      return { ok: false, why: `里程碑 ${id} 的 mutatePath（${mp}）与 claimPath（${cp}）不同址 —— `
        + '改坏不相关字段也能让读数变，那是伪造判别力' }
    }
    const exit = dw.expect_exit === undefined ? 0 : Number(dw.expect_exit)
    if (!Number.isInteger(exit)) return { ok: false, why: `里程碑 ${id} 的 expect_exit 必须是整数（拿到 ${dw.expect_exit}）` }
  } else if (mode === DONE_MODE.evidence) {
    const arts = Array.isArray(dw.artifacts) ? dw.artifacts.map(String).filter(Boolean) : []
    if (!arts.length) {
      return { ok: false, why: `里程碑 ${id} 声明 mode=evidence 但没给 artifacts（证据落在哪）—— `
        + '验存在的判据至少要有一个路径/URL，否则等于「看过了，说圆了」' }
    }
  } else {
    return { ok: false, why: `里程碑 ${id} 缺 done_when.mode [${PLAN_VERSION}] —— 没有判据的里程碑永远到不了 done`
      + `（只收 ${DONE_MODE.cmd} / ${DONE_MODE.evidence}）` }
  }
  return { ok: true, take: takeRes, ...(defineWarnOut ? { define_warn: defineWarnOut } : {}) }
}

export function milestoneWeight(plan, taskId) {
  const t = plan?.tasks?.[String(taskId)]
  if (!t) return 0
  const cap = Number(t.weight) || 0
  const n = Object.values(plan.milestones).filter((m) => m.task === String(taskId)).length + 1
  return Math.max(1, Math.floor(cap / n))
}

export const PLAN_VERSION = 'plan-2026-10-22a'

export function putMilestone(plan, m, tasks, opt = {}) {  if (!plan) plan = newPlan()
  plan.tasks = tasks || plan.tasks || {}
  if (!plan.milestones) plan.milestones = {}
  {
    const prevM = plan?.milestones?.[String(m?.id || '').trim()] || null
    if (prevM) {
      const given = Object.fromEntries(Object.entries(m || {}).filter(([, v]) => v !== undefined && v !== ''))
      m = { ...prevM, ...given }
    }
  }
  const chk = checkMilestone(plan, m, opt)
  if (!chk.ok) return chk
  const id = String(m.id)
  const prev = plan.milestones[id] || null
  const revision = []
  if (prev) {
    for (const k of ['text', 'output', 'task']) {
      const a = String(prev[k] ?? ''), b = String(m[k] ?? prev[k] ?? '')
      if (a !== b) revision.push(`${k}: ${a.slice(0, 40)} → ${b.slice(0, 40)}`)
    }
    const aState = String(prev.define?.state || 'none')
    const bState = String(m.define === undefined ? aState : chk.take.state)
    if (aState !== bState) revision.push(`define.state: ${aState} → ${bState}`)
    for (const k of ['is', 'not', 'limit']) {
      const a = String(prev.define?.[k] ?? ''), b = String(m.define?.[k] ?? prev.define?.[k] ?? '')
      if (a !== b) revision.push(`define.${k}: ${a.slice(0, 36)} → ${b.slice(0, 36)}`)
    }
    const rvOf = (d) => (d?.revisit ? `${d.revisit.kind}:${d.revisit.at}` : '')
    const aRv = rvOf(prev.define)
    const bRv = m.define === undefined ? aRv : rvOf(m.define)
    if (aRv !== bRv) revision.push(`define.revisit: ${aRv || '(无)'} → ${bRv || '(无)'}`)
    const aMode = String(prev.done_when?.mode || '')
    const bMode = String(m.done_when?.mode ?? aMode)
    if (aMode !== bMode) revision.push(`done_when.mode: ${aMode} → ${bMode}`)
    const aCmd = String(prev.done_when?.cmd || '')
    const bCmd = String(m.done_when?.cmd ?? aCmd)
    if (aCmd !== bCmd) revision.push(`done_when.cmd: ${aCmd.slice(0, 50)} → ${bCmd.slice(0, 50)}`)
    const aExit = prev.done_when?.expect_exit
    const bExit = m.done_when?.expect_exit ?? aExit
    if (String(aExit) !== String(bExit)) {
      revision.push(`done_when.expect_exit: ${aExit ?? '(默认0)'} → ${bExit ?? '(默认0)'}`)
    }
    const aArts = (prev.done_when?.artifacts || []).join(' | ')
    const bArts = (m.done_when?.artifacts ?? prev.done_when?.artifacts ?? []).join(' | ')
    if (aArts !== bArts) {
      revision.push(`done_when.artifacts: [${aArts.slice(0, 60)}] → [${bArts.slice(0, 60)}]`)
    }
  }
  const weight = prev ? Number(prev.weight) || 0 : milestoneWeight(plan, m.task)
  const node = {
    id,
    task: String(m.task),
    text: m.text === undefined && prev ? String(prev.text) : String(m.text),
    output: m.output === undefined && prev ? String(prev.output) : String(m.output),
    why: m.why === undefined && prev ? String(prev.why || '') : String(m.why || ''),
    define: {
      state: String(chk.take?.state || 'none'),
      is: String(m.define?.is ?? '').trim(),
      not: String(m.define?.not ?? '').trim(),
      limit: String(m.define?.limit ?? '').trim(),
      ...(chk?.define_warn ? { define_warn: String(chk.define_warn) } : {}),
      ...(chk.take?.take?.state === 'blank' || m.define?.state === 'blank' ? {
        why: String(m.define?.why ?? '').trim(),
        scope: String(m.define?.scope ?? '').trim(),
        ...(m.define?.revisit ? { revisit: { kind: String(m.define.revisit.kind), at: String(m.define.revisit.at) } } : {}),
      } : {}),
      ...(m.define?.state === 'redef' ? {
        was: String(m.define?.was ?? '').trim(),
        now: String(m.define?.now ?? '').trim(),
        why: String(m.define?.why ?? '').trim(),
      } : {}),
    },
    take_factor: Number(chk.take?.factor ?? 0),
    take_half: !!chk.take?.half,
    weight,
    advances: (() => {
      const raw = m.advances === undefined ? (prev ? prev.advances : null) : m.advances
      if (raw === null || raw === undefined) return null
      const t = String(raw).trim()
      return t ? t.slice(0, 40) : null
    })(),
    advances_hist: (() => {
      const base = prev && Array.isArray(prev.advances_hist) ? prev.advances_hist : []
      const nowV = (() => {
        const raw = m.advances === undefined ? (prev ? prev.advances : null) : m.advances
        if (raw === null || raw === undefined) return null
        const t = String(raw).trim()
        return t ? t.slice(0, 40) : null
      })()
      const oldV = prev ? (prev.advances ?? null) : null
      if (!prev || oldV === nowV) return base
      return base.concat([{ at: now(), from: oldV, to: nowV }]).slice(-20)
    })(),
    done_when: {
      mode: String(m.done_when.mode),
      ...(m.done_when.cmd !== undefined ? { cmd: String(m.done_when.cmd) } : {}),
      ...(m.done_when.expect_exit !== undefined ? { expect_exit: Number(m.done_when.expect_exit) } : {}),
      ...(m.done_when.artifacts !== undefined ? { artifacts: (m.done_when.artifacts || []).map(String) } : {}),
      ...(m.done_when.mutatePath !== undefined ? { mutatePath: String(m.done_when.mutatePath) } : {}),
      ...(m.done_when.claimPath !== undefined ? { claimPath: String(m.done_when.claimPath) } : {}),
    },
    ...(m.touches !== undefined ? { touches: m.touches } : (prev?.touches ? { touches: prev.touches } : {})),
    status: String(m.status || '') === 'dropped' ? 'dropped'
      : (String(m.status || '') === 'pending' && prev && prev.status === 'dropped' ? 'pending'
        : (revision.length && prev ? 'pending' : (prev ? prev.status : 'pending'))),
    dropped_why: String(m.status || '') === 'dropped' ? String(m.dropped_why || '').trim()
      : (String(m.status || '') === 'pending' && prev && prev.status === 'dropped' ? ''
        : (prev ? (prev.dropped_why || '') : '')),
    evidence: prev ? (prev.evidence || []) : [],
    revision: prev ? (prev.revision || []).concat(revision.length ? [{ at: now(), changes: revision }] : []) : [],
    boundary_seq: prev ? Number(prev.boundary_seq || 0) + (revision.length ? 1 : 0) : 0,
    judge_seq: (() => {
      const judgeChanged = revision.some((c) => String(c).startsWith('done_when'))
      return prev ? Number(prev.judge_seq || 0) + (judgeChanged ? 1 : 0) : 0
    })(),
    analysis_gate: (() => {
      const judgeChanged = revision.some((c) => String(c).startsWith('done_when'))
      const seq = prev ? Number(prev.judge_seq || 0) + (judgeChanged ? 1 : 0) : 0
      if (seq < 2) return { required: false, judge_seq: seq }
      const WINDOW_MS = 30 * 60 * 1000
      const cutoff = Date.now() - WINDOW_MS
      const recent = (Array.isArray(opt?.contraRecent) ? opt.contraRecent : [])
        .filter((t) => { const v = Date.parse(String(t)); return Number.isFinite(v) && v >= cutoff })
      return recent.length
        ? { required: true, satisfied: true, judge_seq: seq, at: recent[recent.length - 1] }
        : { required: true, satisfied: false, judge_seq: seq, window_min: 30 }
    })(),
    verify_n: prev ? Number(prev.verify_n || 0) : 0,
    last_verify_boundary: prev ? Number(prev.last_verify_boundary || 0) : 0,
    created_at: prev ? prev.created_at : now(),
    updated_at: now(),
  }
  if (node.analysis_gate?.required && node.analysis_gate?.satisfied === false) {
    return {
      ok: false,
      why: `judge_seq=${node.analysis_gate.judge_seq}：这是第 ${node.analysis_gate.judge_seq} 次改「${id}」的判据，`
        + `但最近 ${node.analysis_gate.window_min} 分钟内没有任何矛盾分析记录。`
        + '第一次改不管（写错了改一下是正常的）；改到第二次说明第一次没想清 —— '
        + '先用 brain_contra 说清「这次换的是哪类矛盾、走哪手、欠什么」，再回来改判据。',
      analysis_gate: node.analysis_gate,
    }
  }
  plan.milestones[id] = node
  const sibs = Object.values(plan.milestones).filter((m) => m.task === node.task)
  const cap = Number(plan.tasks?.[node.task]?.weight) || 0
  const even = sibs.length ? Math.max(1, Math.floor(cap / sibs.length)) : cap
  for (const s of sibs) {
    s.weight = even
    s.updated_at = now()
  }
  plan.revision = (plan.revision || 0) + (revision.length ? 1 : 0)
  plan.updated_at = now()
  return {
    ok: true, node: plan.milestones[id], weight: plan.milestones[id].weight,
    status: plan.milestones[id].status,
    dropped_why_set: Boolean(String(plan.milestones[id].dropped_why || '').trim()),
    siblings: sibs.length, evenly: even,
    revised: revision.length > 0, changes: revision, reset: revision.length > 0 && !!prev,
  }
}

export function judgeDone(plan, id, result) {
  const m = plan?.milestones?.[String(id)]
  if (!m) return { ok: false, status: 'pending', why: `里程碑 ${id} 不存在` }
  const mode = m.done_when.mode
  const r = result || {}
  if (r.mode !== mode) {
    return { ok: false, status: m.status,
      why: `判据是 ${mode}，但这次给的是 ${r.mode || '（空）'} —— 换了形态就等于换了判据，拒收` }
  }
  let pass = false
  let why = ''
  if (mode === DONE_MODE.cmd) {
    const want = m.done_when.expect_exit === undefined ? 0 : m.done_when.expect_exit
    pass = Number(r.exit) === want
    why = `退出码 ${r.exit === undefined ? '（无）' : r.exit}，期望 ${want}`
  } else if (mode === DONE_MODE.pair) {
    const want = m.done_when.expect_exit === undefined ? 0 : m.done_when.expect_exit
    const p = r.pair || {}
    const lack = []
    if (p.normalExit == null) lack.push('normalExit')
    if (p.mutantExit == null) lack.push('mutantExit')
    if (p.sameField == null) lack.push('sameField')
    if (lack.length) {
      pass = false
      why = `pair 模式缺 ${lack.join(' / ')} —— 同址翻红要三件齐，缺一件判不了`
    } else {
      const nearOk = Number(p.normalExit) === want
      const mutOk = Number(p.mutantExit) !== want
      const sameOk = p.sameField === true
      const failedOk = r.failed !== true
      const restoredOk = r.restored === true
      const noTimeout = r.timedOut !== true
      pass = nearOk && mutOk && sameOk && failedOk && restoredOk && noTimeout
      why = pass
        ? `同址翻红成立：正常 ${p.normalExit}（期望 ${want}）/ 改坏后 ${p.mutantExit} / 同址 ${p.sameField}`
        : `同址翻红不成立：正常 ${p.normalExit}（期望 ${want}）/ 改坏后 ${p.mutantExit} / 同址 ${p.sameField}`
          + `${!nearOk ? '｜正常态就不合期望' : ''}${!mutOk ? '｜改坏后读数没变（判据恒绿）' : ''}${!sameOk ? '｜改坏点与 claim 不同址（判别力伪造）' : ''}`
          + `${!failedOk ? `｜采集层标了失败${r.why ? `（${r.why}）` : ''}` : ''}`
          + `${!restoredOk ? '｜状态文件没还原成功（读数不可信）' : ''}`
          + `${!noTimeout ? '｜有超时（超时不构成翻红）' : ''}`
    }
  } else if (mode === DONE_MODE.evidence) {
    const want = m.done_when.artifacts
    const found = (r.found || []).map(String)
    const given = Array.isArray(r.missing) ? r.missing.map(String) : null
    const computed = want.filter((a) => !found.includes(String(a)))
    const missing = (given && given.length) ? given : computed
    pass = missing.length === 0
    why = pass ? `${want.length} 件证据全部到位` : `缺 ${missing.length} 件：${missing.join(', ')}`
  } else {
    pass = false
    why = `判据形态「${mode}」没有接进判绿逻辑 —— 不认识的形态一律不放行（不是"通过"）`
  }
  const jury = r.jury || null
  if (jury && jury.decision === 'pass') m.unverified_n = 0
  if (jury && jury.decision) {
    const fp = `${(m.done_when && m.done_when.cmd) || (m.done_when && m.done_when.mode) || ''}|${m.boundary_seq ?? 0}`
    if (!m.jury_fp || typeof m.jury_fp !== 'object') m.jury_fp = {}
    const rec = m.jury_fp[fp] || { lastDecision: null, passStreak: 0 }
    if (jury.decision === 'pass') {
      const wasNonGreen = rec.lastDecision && rec.lastDecision !== 'pass'
      rec.passStreak = wasNonGreen ? (Number(rec.passStreak) || 0) + 1 : 0
      if (wasNonGreen && rec.passStreak < 2) {
        pass = false
        why = `${why}；⚠️ 同一证据指纹曾被判「${rec.lastDecision}」⇒ 这次 pass **不算绿**（同指纹需连续两次 pass）。`
          + ' 理由：实测同一 claim 反复开庭会翻到 pass（INSTITUTIONS 第二十一批）'
        m.pass_unstable = true
      } else {
        m.pass_unstable = false
      }
    } else {
      rec.passStreak = 0
    }
    rec.lastDecision = jury.decision
    m.jury_fp[fp] = rec
  }
  if (jury && jury.decision && jury.decision !== 'topped') {
    m.blocked_on = ''
  }
  if (pass && jury && jury.decision === 'pass') m.topped_streak = 0
  const machinePass = pass
  if (pass && jury && jury.decision && jury.decision !== 'pass') {
    if (jury.decision === 'unavailable') {
      m.unverified_n = Number(m.unverified_n || 0) + 1
      why = `${why}；⚠️ 陪审未开成庭 ⇒ 本条未经陪审复核（抓错能力未验证），不挡交付`
        + `（欠开庭 ${m.unverified_n} 次）`
    } else if (jury.decision === 'topped') {
      pass = false
      const miss = (jury.missing || []).join(' / ')
      const streak = Number(m.topped_streak || 0) + 1
      m.topped_streak = streak
      if (streak < 2) {
        m.blocked_on = ''
        why = `${why}；🚧 陪审判证据到顶（第 1 次）：${jury.why}（缺：${miss || '陪审未点名'}）`
          + '——到顶≠可停。两条出口任选：①把判据改成**任何人复跑都能判真假**的断言'
          + '（改 claim，不是继续补同一类证据）；②给出**具名承接者**（谁能做、怎么找他）。'
          + '连续两次到顶才认 blocked。'
      } else {
        m.blocked_on = miss
        why = `${why}；🚧 陪审判证据到顶（连续 ${streak} 次）：${jury.why}`
          + `（缺的外部条件：${miss || '陪审未点名'}）——接不可达`
      }
    } else {
      pass = false
      why = `${why}；但陪审未通过：${jury.why}`
        + (jury.decision === 'unclear' ? '（判据含糊 ⇒ 改写 done_when，补证据没用）'
          : `（缺：${(jury.missing || []).join(' / ') || '陪审未给出缺项'}）`)
    }
  }
  const covers = (() => {
    const explicit = Array.isArray(r.covers) ? r.covers.filter((x) => String(x || '').trim()) : []
    if (explicit.length) return [...new Set(explicit.map(String))].slice(0, 12)
    const cmd = String((m.done_when && m.done_when.cmd) || '')
    const re = /[\w.\-\/]+\.(?:mjs|cjs|js|ts|tsx|jsx|py|json|md|vue|css|html)/g
    return [...new Set(cmd.match(re) || [])].slice(0, 12)
  })()

  const slimJury = jury ? {
    decision: jury.decision,
    why: String(jury.why || '').slice(0, 160),
    n: jury.n, support: jury.support, insufficient: jury.insufficient,
    undecidable: jury.undecidable, external: jury.external ?? 0,
    unanimous: !!jury.unanimous,
    missing: (jury.missing || []).slice(0, 3).map((x) => String(x).slice(0, 80)),
    ...(Array.isArray(jury.missing_kind) ? { missing_kind: jury.missing_kind.slice(0, 3) } : {}),
    ...(jury.overreached === true ? { overreached: true } : {}),
    gaps: (jury.gaps || []).slice(0, 3).map((x) => String(x).slice(0, 120)),
    votes: (jury.votes || []).slice(0, 3).map((v) => ({
      role: v.role, verdict: v.verdict, reason: String(v.reason || '').slice(0, 60),
      boundary: v.boundary || '',
      missing: String(v.missing || '').slice(0, 60),
    })),
    at: jury.at, provider: jury.provider, model: jury.model,
  } : null
  m.evidence = (m.evidence || []).concat([{
    at: now(), mode, exit: r.exit ?? null, found: r.found ?? null,
    missing: r.missing ?? null, note: r.note ? String(r.note) : '', pass, why,
    machine_pass: machinePass, jury: slimJury,
    out_tail: (() => {
      const o = r && (r.out ?? r.stdout ?? r.output ?? r.log)
      if (!o) return ''
      const t = String(o)
      return t.length > 3000 ? `…（前 ${t.length - 3000} 字略）…\n` + t.slice(-3000) : t
    })(),
    covers,
    ...(() => {
      const sub = (r && r.submission) || {}
      const proof = Array.isArray(sub.proof) ? sub.proof.map(String).filter(Boolean).slice(0, 12) : []
      const assumptions = Array.isArray(sub.assumptions) ? sub.assumptions.map(String).filter(Boolean).slice(0, 8) : []
      const pend = Array.isArray(sub.pending) ? sub.pending.map(String).filter(Boolean).slice(0, 8) : []
      if (!proof.length && !assumptions.length && !pend.length) return {}
      return {
        submission: {
          proof,
          assumptions,
          pending: pend,
        },
      }
    })(),
    changed: Array.isArray(r.changed) ? r.changed.slice(0, 20) : null,
    git_ok: r.git_ok === true,
    uncovered: (Array.isArray(r.changed) && covers.length)
      ? r.changed.filter((f) => !covers.some((c) => String(f).includes(String(c)) || String(c).includes(String(f)))).slice(0, 12)
      : (Array.isArray(r.changed) ? r.changed.slice(0, 12) : null),
  }]).slice(-20)
  m.status = pass ? 'done' : (m.blocked_on ? 'blocked' : (r.failed === true ? 'failed' : 'pending'))
  m.verify_n = Number(m.verify_n || 0) + 1
  m.last_verify_boundary = Number(m.boundary_seq || 0)
  m.done_at = pass ? now() : (m.done_at || null)
  m.updated_at = now()
  plan.updated_at = now()
  const uncovered = m.evidence.slice(-1)[0]?.uncovered ?? null
  return { ok: true, status: m.status, why, covers, changed: m.evidence.slice(-1)[0]?.changed ?? null, uncovered,
    covers_note: covers.length
      ? `这条判据覆盖 ${covers.length} 个文件：${covers.join('、')}`
      : '⚠️ 这条判据**一个文件都没提到** ⇒ 它验的东西对不上任何改动（改动不可见）' }
}

export function channelGate(plan, id) {
  const m = (plan?.milestones || {})[String(id || '')]
  if (!m) return { blocked: false }
  const bs = Number(m.boundary_seq || 0)
  const lb = Number(m.last_verify_boundary || 0)

  const ev0 = (m.evidence || []).filter((e) => e && e.jury && e.jury.decision)
  const last0 = ev0.length ? ev0[ev0.length - 1] : null
  const d0 = last0 ? String(last0.jury.decision) : ''
  if (d0 === 'pass' || d0 === 'unavailable') return { blocked: false }

  const BS_LIMIT = 3
  if (bs >= BS_LIMIT) {
    return {
      blocked: false, exhausted: true, boundary_seq: bs,
      hint: `边界已改过 ${bs} 次（上限 ${BS_LIMIT}）` + (d0 ? `，陪审仍判「${d0}」` : '，陪审一次都没开庭')
        + ' —— **这不是"边界不足"，是"这条 claim 本身过不了"**。'
        + ' 别再改边界了（再改也只是换个说法，闸会一直说"变过了"）。三条出口，选一条：'
        + ' ① 缩小 claim（真子集，不是换说法）；② brain_escalate 上报要资源；③ dropped（写清 dropped_why）。',
    }
  }

  const ev = (m.evidence || []).filter((e) => e && e.jury && e.jury.decision)
  if (!ev.length) return { blocked: false }
  const last = ev[ev.length - 1]
  const d = String(last.jury.decision)
  if (d === 'pass' || d === 'unavailable') return { blocked: false }


  if (bs > lb) return { blocked: false }
  return {
    blocked: true,
    why: `上一次陪审判「${d}」之后，这条里程碑的**边界没变过**（boundary_seq=${bs}，上次验时=${lb}）—— `
      + '原地重跑同一条判据不会得到新结论',
    hint: '陪审卡住是"边界不足"的证据，不是"再跑一遍"。先重新取一次（任选其一）：'
      + '① 改 define（is/not/limit，或 redef 写 was/now/why）；② 改 done_when；③ 换一条"改坏就必红"的断言。'
      + '改完 boundary_seq 会 +1，那时再 verify。',
  }
}


const USER_VIEW = /(用户|使用|他(?:能|可以)|我(?:能|可以|要|想)|界面上?|点一下|点开|少点|不用再|方便)/
const TECH_ONLY = /(自检|断言|脚本|服务|端口|进程|退出码|绿|STATE\.md|截图|徽标|徽章)/
export function checkGoalIsomorphism(want, text = '') {
  const w = String(want || '')
  if (!w.trim()) return { mismatch: false, why: 'want 为空 ⇒ 无从判（先写清"看到什么才算成了"）', level: 'none' }
  if (USER_VIEW.test(w)) return { mismatch: false, why: 'want 里带了使用者视角', level: 'ok' }
  if (!TECH_ONLY.test(w)) return { mismatch: false, why: 'want 里既无使用者视角也无技术指标 ⇒ 判不出来', level: 'unclear' }
  return {
    mismatch: true, level: 'tech-only',
    why: '这条 want 全是技术指标（自检/断言/截图/销账），**没有一处是"使用者能做什么"** ⇒ 判据与目标**不同构**：它证明不了自己（自检全绿而用户仍不会用，完全可能）。'
      + ' 出口：补一句"用户要的那件事，他做完能看到/能做到什么"，或确认这条任务本来就是内部技术活。',
    sample: String(text || '').slice(0, 60),
  }
}

export function stuckMilestones(plan, { verifyMin = 3, boundaryMin = 2 } = {}) {
  return Object.values(plan?.milestones || {})
    .filter((m) => m && m.status !== 'done'
      && Number(m.verify_n || 0) >= verifyMin
      && Number(m.boundary_seq || 0) >= boundaryMin)
    .map((m) => ({ id: m.id, status: m.status, verify_n: Number(m.verify_n || 0), boundary_seq: Number(m.boundary_seq || 0) }))
}

export function juryStats(plan) {
  const t = { pass: 0, fail: 0, topped: 0, unclear: 0, hung: 0, unavailable: 0 }
  for (const m of Object.values(plan?.milestones || {})) {
    for (const e of (m.evidence || [])) {
      const d = e && e.jury && e.jury.decision
      if (!d) continue
      if (d in t) t[d] += 1
    }
  }
  const judged = t.pass + t.fail + t.topped + t.unclear + t.hung
  return {
    ...t,
    judged,
    heard: judged + t.unavailable,
    pass_rate: judged ? Number((t.pass / judged).toFixed(3)) : null,
    note: judged === 0 ? '还没有开过庭（unavailable 不计入通过率）' : '',
  }
}

export function checkUnreachable(plan, args) {
  const a = args || {}
  const missing = String(a.missing || '').trim()
  if (!missing) {
    return { ok: false, why: '不可达时要指名缺哪个外部条件（missing）：说不出缺什么，就不是不可达，是还没做完。' }
  }
  const blockedEv = String(a.blocked_evidence || '').trim()
  const needBlockedEv = () => (blockedEv.length < 10
    ? { ok: false, why: '「不可达」是**终局声明**（说这件事办不到），所以要附**阻断证据**（blocked_evidence）：'
      + '做过一次取证、它在缺这个条件时失败了，写清命令与失败输出（≥10 字）。\n'
      + '⚠️ 但如果你只是想**请用户做一件事**（重启一次、复跑一条命令、给个凭证）—— 那不是不可达：'
      + '用 `brain_task` 记一条依赖（等他做完你再继续），或在回复里直接说。**那一路不需要这条证据，默认就这么办。**\n'
      + '只有当用户明确要求「想尽一切办法」时，才需要去琢磨怎么绕过取证。' }
    : null)
  const byId = (id) => (plan?.milestones || {})[String(id || '')] || null
  const ms = Object.values(plan?.milestones || {})
  const pend = ms.filter((m) => m.status === 'pending')

  if (String(a.scope || '') === 'milestone') {
    const mid = String(a.milestone || '').trim()
    const m = byId(mid)
    if (!m) {
      return { ok: false, why: `scope=milestone 时必须给 milestone（要声明的那条里程碑 id）——${mid ? `盘上找不到 ${mid}` : '当前没给'}。` }
    }
    const topped2 = Number(m.topped_streak || 0) >= 2
    const topppedPending = m.status === 'pending' && String(m.blocked_on || '').trim() && topped2
    if (!['blocked', 'failed'].includes(m.status) && !topppedPending) {
      return { ok: false, why: `里程碑 ${mid} 当前是 ${m.status}：只有 blocked / failed（或"到顶但未认 blocked"的 pending）才能单独声明不可达；普通的 pending 是"还能补"，不许绕过。` }
    }
    const evMiss = needBlockedEv()
    if (evMiss) return evMiss
    return { ok: true, scope: 'milestone', milestone: mid, missing, blocked_evidence: blockedEv,
      note: `只对里程碑 ${mid} 声明不可达；任务层账不变，turn-stopping 不因它放行。` }
  }

  if (pend.length) {
    return { ok: false, why: `「不可达」被拒：还有 ${pend.length} 条里程碑是 pending（${pend.map((m) => m.id).join('、')}）。`
      + '局部卡住 ≠ 整件不可达 —— 出口：①把 pending 收束（`brain_plan` 处置成 dropped 并写 why。schema 只认 dropped：failed 是「做不成」、dropped 是「决定不做」，账上不混桶）；'
      + '②若只有某一条到顶，用 `scope="milestone"` + `milestone=<id>` 只对那条声明。' }
  }
  const owner = String(a.owner || '').trim()
  if (owner.length < 4) {
    return { ok: false, why: '「不可达」必须给承接者（owner）：谁能提供这个外部条件、怎么找他。'
      + '少于 4 个字视为没给 —— 没有承接者的"不可达"等于免票。' }
  }
  const evMiss2 = needBlockedEv()
  if (evMiss2) return evMiss2
  return { ok: true, scope: 'task', owner, missing, blocked_evidence: blockedEv, note: `承接者：${owner}` }
}

const SELF_SUBJECT = /(我写|我跑|本机制|这个脚本|这份报告|脚本本身|自检脚本|这条命令自己|我自己)/
const SELF_PRED = /(证明|说明|保证|没说谎|确实跑通|确由|产出|生成了)/

export function looksSelfReferential(claim) {
  const s = String(claim || '')
  return SELF_SUBJECT.test(s) && SELF_PRED.test(s)
}

export function selfRefGate(plan, id) {
  const m = (plan?.milestones || {})[String(id || '')]
  if (!m) return { blocked: false }
  const claim = String(m.text || '')
  if (!looksSelfReferential(claim)) return { blocked: false }
  const hint = '这条 claim 是"自证型"（要证明它自己产出的东西没说谎）：陪审只能判成"不够"。'
    + '正确出口是把 claim 改写成"改坏被测代码时该命令必须非 0"这类**任何人复跑都能判真假**的断言。'
  let internalFails = 0
  for (const e of (m.evidence || [])) {
    const j = e && e.jury
    if (!j || !j.decision || j.decision === 'pass') continue
    const votes = Array.isArray(j.votes) ? j.votes : []
    if (votes.some((v) => String(v?.boundary || '').toLowerCase() === 'internal')) internalFails += 1
  }
  if (internalFails >= 2) {
    return { blocked: true, hint,
      why: `claim 已 ${internalFails} 次被陪审指出"缺的是你自己还能造的"（internal）—— 同一个形状再开会得到同一个结论` }
  }
  return { blocked: false, hint }
}

export function deliveryOf(plan, taskId) {
  const ms = Object.values(plan?.milestones || {}).filter((m) => m.task === String(taskId))
  const done = ms.filter((m) => m.status === 'done')
  const failed = ms.filter((m) => m.status === 'failed')
  const pending = ms.filter((m) => m.status === 'pending')
  const blocked = ms.filter((m) => m.status === 'blocked')
  const escalated = ms.filter((m) => m.status === 'escalated')
  const dropped = ms.filter((m) => m.status === 'dropped')
  const factorOf = (m) => {
    const f = m?.take_factor
    if (f === undefined || f === null) return 1
    const n = Number(f)
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1
  }
  const eff = (m) => (Number(m.weight) || 0) * factorOf(m)
  const weight = ms.reduce((s, m) => s + (Number(m.weight) || 0), 0)
  const doneWeight = done.reduce((s, m) => s + eff(m), 0)
  const blanks = ms.filter((m) => m.define?.state === 'blank')
  const noneStated = ms.filter((m) => !m.define?.state || m.define.state === 'none')
  return {
    task: String(taskId),
    total: ms.length, done: done.length, pending: pending.length, failed: failed.length, blocked: blocked.length, escalated: escalated.length,
    dropped: dropped.length, droppedIds: dropped.map((m) => m.id),
    weight, doneWeight,
    progress: weight ? doneWeight / weight : (ms.length ? done.length / ms.length : 0),
    allGreen: ms.length > 0 && done.length === ms.length,
    allGreenExceptDropped: ms.length > 0 && done.length + dropped.length === ms.length && dropped.length > 0,
    hasPlan: ms.length > 0,
    blank: blanks.length, blankIds: blanks.map((m) => m.id),
    half: ms.filter((m) => m.take_half).length, halfIds: ms.filter((m) => m.take_half).map((m) => m.id),
    noneStated: noneStated.length, noneStatedIds: noneStated.map((m) => m.id),
    pendingIds: pending.map((m) => m.id),
    failedIds: failed.map((m) => m.id),
    blockedIds: blocked.map((m) => m.id),
    escalatedIds: escalated.map((m) => m.id),
  }
}

export function deliveryAll(plan, tasks) {
  const out = {}
  for (const t of Object.values(tasks || {})) {
    if (t.status === 'superseded') continue
    out[t.id] = deliveryOf(plan, t.id)
  }
  return out
}

export function planLights(plan, tasks, sit = {}) {
  const lights = []
  if (!plan || !Object.keys(plan.milestones || {}).length) {
    const all = Object.values(tasks || {}).filter((t) => t.status !== 'superseded')
    const have = all.filter((t) => String(t.id) !== 'META')
    if (have.length) {
      lights.push(`🔴 有任务无计划：${have.length} 条用户任务，0 个里程碑`
        + ` ⇒ 出口：用 brain_plan 把其中一条拆成里程碑（每个必须有 output + done_when）`)
    } else if (all.length) {
      lights.push('· 还没有用户任务，无从拆解（账上只有 META——机制自身的保留节点，不是活）')
    }
    return lights
  }
  {
    const stuck = stuckMilestones(plan)
    if (stuck.length) {
      lights.push(`🟠 ${stuck.length} 条里程碑**改了几轮判据仍不绿**（${stuck.map((x) => `${x.id}:验${x.verify_n}/改${x.boundary_seq}`).join('、')}）`
        + ' —— 事实摆在这里。**按原文：高影响矛盾先试"合"，合不了才"分"。**'
        + ' 四种合：① 升维（`brain_lift_check`：换一层，把旧命题包含进来）'
        + ' ② 降维（`brain_contra act:"降维"`：拆成两块互不重叠的子问题）'
        + ' ③ 换域（换一个判据空间：命令→产物、自检→使用者动作）'
        + ' ④ 重构（`act:"重定义"`：把"X 不行"改成"X 在什么条件下才行"）。'
        + ' **四种都试过仍不成立**，再走分：取舍（让给谁、代价是什么）并写清 `if_wrong`。')
    }
  }

  {
    const LIVE_STATUSES = ['pending', 'failed', 'escalated']
    const live = Object.values(plan.milestones || {}).filter((m) => LIVE_STATUSES.includes(String(m.status)))
    const orphans = []
    const ghosts = []
    for (const m of live) {
      const t = (tasks || {})[m.task]
      const wants = Array.isArray(t?.wants) ? t.wants : []
      const adv = m.advances == null ? null : String(m.advances)
      if (!wants.length) continue
      if (!adv) { orphans.push(m.id); continue }
      if (!wants.some((w) => String(w.id) === adv)) ghosts.push(`${m.id}→${adv}`)
    }
    if (orphans.length) {
      lights.push(`🟠 ${orphans.length} 条里程碑**没声明推进哪个目标**（${orphans.join('、')}）`
        + ' ⇒ 出口：在 brain_plan 里填 `advances=<task.wants 里的 id>`。'
        + ' 填不出 ⇒ 这条活本来就不为你要的东西服务，那是漂移，不是"还没想好"。')
    }
    if (ghosts.length) {
      lights.push(`🔴 ${ghosts.length} 条里程碑**在推进一个已经不存在的目标**（${ghosts.join('、')}）`
        + ' ⇒ 这是最危险的一种漂移：**它干的还是原来那件事，但你要的已经变了**。'
        + ' 出口：① 把那条 want 加回 task.wants（如果你还要）；② 改 advances 指向新的那条；③ 这条活本身就该停。')
    }
  }

  const unvMs = Object.values(plan.milestones || {}).filter((m) => Number(m.unverified_n || 0) > 0)
  if (unvMs.length) {
    const totalUnv = unvMs.reduce((a, m) => a + Number(m.unverified_n || 0), 0)
    lights.push(`🟠 ${unvMs.length} 条里程碑**未经陪审复核**（累计欠开庭 ${totalUnv} 次：`
      + `${unvMs.map((m) => `${m.id}×${m.unverified_n}`).join('、')}）`
      + ' ⇒ 出口：重跑 brain_verify 把庭开成（unavailable 零信息，不算审过；不挡交付，但别当它验过）')
  }

  for (const [tid, d] of Object.entries(deliveryAll(plan, tasks))) {
    if (String(tid) === 'META') continue
    if (!d.hasPlan) {
      lights.push(`🟠 ${tid} 无计划 ⇒ 出口：brain_plan 拆一步也算（宁可粗，不可空）`)
      continue
    }
    if (d.allGreen) {
      lights.push(`🟢 ${tid} 全部里程碑已绿（${d.done}/${d.total}）⇒ 可以收尾：`
        + '但收尾要说清「交付物在哪、怎么验」，不是「这一轮做了几件」')
      continue
    }
    if (d.failed > 0) {
      lights.push(`🔴 ${tid} 有 ${d.failed} 个里程碑判据判负（${d.failedIds.join(',')}）`
        + ' ⇒ 出口二选一：修到达标 / 用 brain_plan 改判据（改判据会让它回 pending，并留痕）')
    }
    if (d.blocked > 0) {
      lights.push(`🚧 ${tid} 有 ${d.blocked} 个里程碑**证据到顶**（${d.blockedIds.join(',')}）`
        + ' ⇒ 不是"再补一件"：缺的只有外部能给。出口：brain_terminate 声明「不可达」并指名缺哪个外部条件。'
        + '（若外部条件后来到齐了，重跑 brain_verify 即可回绿。）')
    }
    const never = Object.values(plan.milestones).filter((m) => m.task === tid
      && m.status === 'pending' && !(m.evidence || []).length)
    if (never.length) {
      lights.push(`🟠 ${tid} 有 ${never.length} 个里程碑的判据**从未执行过**（${never.map((m) => m.id).slice(0, 4).join(',')}）`
        + ' ⇒ 出口：跑一次 brain_verify（判据没跑过 = 还没判据）')
    }
    if (d.pending > 0) {
      lights.push(`⚪ ${tid} 还差 ${d.pending} 个里程碑（${d.pendingIds.slice(0, 5).join(',')}），`
        + `进度 ${(d.progress * 100).toFixed(0)}%（按权重，留空的按 ${TK.BLANK_FACTOR} 折）`)
    }
    const mLights = Object.values(plan.milestones).filter((m) => m.task === tid)
    const dueNow = []
    const blankWait = []
    for (const m of mLights) {
      const st = m.define?.state
      if (st === 'blank') {
        const due = TK.blankDue({ state: 'blank', revisit: m.define?.revisit, scope: m.define?.scope }, sit)
        if (due.due) dueNow.push(`${m.id}（${due.why}）`)
        else blankWait.push(`${m.id}〔等 ${m.define?.revisit?.at || '未挂触发'}〕`)
      }
    }
    if (dueNow.length) {
      lights.push(`🟠 ${tid} 有 ${dueNow.length} 处留空**到期了**：${dueNow.slice(0, 4).join('；')}`
        + ' ⇒ 出口：现在能给出就改成 given；还不行就换一个更近的 revisit 触发并说明为什么原来的到不了。'
        + '**不许既不填也不改触发**（那就是把空挂着当免罪）')
    }
    if (blankWait.length) lights.push(`⚪ ${tid} 留空中（未到期，不催）：${blankWait.slice(0, 4).join('；')}`)
    if (d.half) {
      lights.push(`🟠 ${tid} 有 ${d.half} 条里程碑只写了**半张**定义（${d.halfIds.slice(0, 4).join(',')}）`
        + ' ⇒ 出口二选一：补齐另外两问；或明确改成 blank 并写 why / scope / revisit。'
        + '半张的危险不是不完整，是它会被当成真定义引用（M1/M2 同命令判绿两件事就是这么来的）')
    }
    if (d.noneStated) {
      lights.push(`🔴 ${tid} 有 ${d.noneStated} 个里程碑**从未表态**（${d.noneStatedIds.slice(0, 4).join(',')}）`
        + ' —— 不是留空，是没说话 ⇒ 出口三选一：给定义 / 标 blank（带为什么与回来条件）/ 标 redef（带原来是什么）')
    }
  }
  {
    const un = Object.values(tasks || {}).filter((t) => t && t.id !== 'META' && t.status !== 'superseded'
      && t.status !== 'invalid' && !t.contradiction)
    if (un.length) {
      lights.push(`🟠 ${un.length} 条任务**没挂矛盾**（${un.map((t) => t.id).slice(0, 5).join(' / ')}）`
        + ' —— 挂法：`brain_contra op:"observe"` 说清哪两条路径走到同一终点、结果不同，'
        + '再把节点 id 填进 `brain_task` 的 `contradiction`。不挂不影响干活，只是没法从账上看出这条任务在解哪一对拉扯。')
    }
  }
  return lights
}

export function stalledOf(m) {
  if (m?.status === 'done' || m?.status === 'dropped') return null
  const ev = (m?.evidence || []).filter((e) => e && e.jury)
  if (ev.length < 3) return null
  const CATS = [
    ['K1-第三方独立实现', /独立.?实现|第三方独立|另一套实现|不能是当事人自写|非当事人自写|第三方复算/],
    ['K2-第三方复跑/重算', /第三方复跑|独立复跑|独立重跑|外部独立重跑|独立复算|独立重算|从原始K线.*复算|复算四数/],
    ['K3-证明真调了那个库', /__file__|_native\.pyd|签名|实际被 ?import|调用栈|czsc 实际/],
    ['K4-原始输入/哈希', /sha256|哈希|原始K线文件|原始K线数据|输入数据哈希/],
    ['K5-变异/反例断言', /改坏|变异|必须非 ?0|必须 ?非0|反例|FAIL|失败侧/],
    ['K6-容差与预登记', /容差|预登记|阈值/],
    ['K7-可复跑的推导过程', /逐步|推导|复跑脚本|可复跑脚本|任何人.*复跑|逐笔明细|公式/],
    ['K8-时间戳/时序凭证', /时间戳|时序|TSA|托管记录|证明登记早于/],
    ['K9-同口径对齐', /同口径|同一.*口径|逐项对齐|统一.*口径/],
    ['K10-git 溯源', /git ?log|cat-file|commit/],
    ['K11-原始数据导出/独立读取', /原始.{0,10}导出|独立读取|全量导出|state 原文|原文导出/],
    ['K12-负向对照/判别用例', /负向对照|判别用例|改坏.{0,8}非 ?0|越界.{0,6}对照|识别力/],
    ['K13-范围完整性', /即全量|总数.{0,8}核对|无遗漏|范围.{0,4}=.{0,4}全部|全量.{0,6}枚举/],
  ]
  const catsOf = (e) => {
    const miss = Array.isArray(e.jury.missing) ? e.jury.missing : (e.jury.missing ? [e.jury.missing] : [])
    const text = miss.map(String).join('；')
    return new Set(CATS.filter(([, re]) => re.test(text)).map(([id]) => id))
  }
  const tail = ev.slice(-3).map(catsOf)
  if (tail.some((s) => !s.size)) return null
  const cnt = {}
  for (const s of tail) for (const k of s) cnt[k] = (cnt[k] || 0) + 1
  const common = Object.entries(cnt).filter(([, n]) => n >= 2).map(([k]) => k)
  if (!common.length) return null
  const miss = Array.isArray(ev[ev.length - 1].jury.missing) ? ev[ev.length - 1].jury.missing : []
  const one = String((miss || [])[0] || '').slice(0, 60)
  return {
    streak: 3,
    sameAs: common.join(', '),
    line: [
      '🔁 stalled(m) = true',
      '   定义：stalled ⟺ |⋂_{t=n-2..n} M_t| ≥ 1  ∧  status ∉ {done, dropped}',
      '         （M_t = 第 t 轮陪审点名的 missing 归到类别后的集合；K 类见本文件 CATS）',
      `   当前：⋂ = {${common.join(', ')}}；status = ${String(m?.status || 'pending')}${one ? `；最近点名「${one}…」` : ''}`,
      '   出口（每条都带判据，不是建议）：',
      '     ① 补证据     ⇒ 判据：下一轮 missing 里不再出现 ⋂ 中的类（使 |⋂| = ∅）',
      '     ② 缩小 claim ⇒ 判据：C_new ⊂ C_old（关键集合真包含）；换说法（C_new = C_old）不算',
      '     ③ dropped    ⇒ 判据：brain_plan(status=dropped, dropped_why ≥ 10 字) 返回 ok',
      '   ⚠️ 改判据不算出口：它让 claim 变，|⋂| 会被重置 —— 那是"消失"，不是"解决"。',
    ].join('\n'),
  }
}
export const METHOD = {
  DOWN: '降维',
  BALANCE: '平衡',
  TRANSFER: '转移',
  TAKE_VOID: '取无',
  KEEP: '保留',
  RAISE: '升维',
  HUMAN: '转人工',
}
export const EPS_LOW = 0.5
export const EPS_HIGH = 2

export function contraStrength(m) {
  const ev = (m?.evidence || []).filter((e) => e && e.jury)
  if (!ev.length) return null
  const last = ev[ev.length - 1].jury || {}
  const miss = Array.isArray(last.missing) ? last.missing : (last.missing ? [last.missing] : [])
  const conflicts = miss.filter((x) => String(x || '').trim()).length
  const depth = Math.max(1, Number(m?.verify_n || ev.length || 1))
  return { conflicts, depth, strength: Number((conflicts / depth).toFixed(3)) }
}

export function decideAction(m, opts = {}) {
  const o = opts || {}
  const stalled = o.stalled === true
  const canRaise = o.canRaise !== false
  const canCoexist = o.canCoexist === true
  const canTransfer = o.canTransfer === true
  const canTakeVoid = o.canTakeVoid === true

  const c = contraStrength(m)
  const base = { strength: c ? c.strength : null, conflicts: c ? c.conflicts : null, depth: c ? c.depth : null }

  if (stalled) {
    return { ...base, method: canRaise ? METHOD.RAISE : METHOD.HUMAN,
      reason: canRaise
        ? '同一类要求反复（stalled）⇒「补观测」已失效，按判定表走升维'
        : '同一类要求反复（stalled）且找不到可升的新基 ⇒ 按判定表转人工' }
  }

  if (!c) {
    return { ...base, method: METHOD.DOWN, reason: '还没有陪审记录 ⇒ 先补一条观测（还没有强度，谈不上选方法）' }
  }

  if (c.strength < EPS_LOW) {
    return { ...base, method: METHOD.DOWN,
      reason: `强度 ${c.strength} < ${EPS_LOW} ⇒ 按判定表走降维（找低曲率子区域，局部线性化）` }
  }

  if (c.strength >= EPS_HIGH) {
    return { ...base, method: canRaise ? METHOD.RAISE : METHOD.HUMAN,
      reason: canRaise
        ? `强度 ${c.strength} >= ${EPS_HIGH} ⇒ 局部调参必然失效，按判定表必须升维`
        : `强度 ${c.strength} >= ${EPS_HIGH} 但找不到可升的新基 ⇒ 按判定表转人工` }
  }

  if (canCoexist) {
    return { ...base, method: METHOD.BALANCE,
      reason: `强度 ${c.strength} 在 [${EPS_LOW},${EPS_HIGH}) 且可共存 ⇒ 按判定表走平衡（代价：持续能量 + 人调）` }
  }
  if (canTransfer) {
    return { ...base, method: METHOD.TRANSFER,
      reason: `强度 ${c.strength} 中段、不可共存但可转移 ⇒ 按判定表走转移（代价：反弹时间 ∝ 距离）` }
  }
  if (canTakeVoid) {
    return { ...base, method: METHOD.TAKE_VOID,
      reason: `强度 ${c.strength} 中段、不可共存不可转移但可取无 ⇒ 按判定表走取无（引入对冲变量）` }
  }
  return { ...base, method: METHOD.KEEP,
    reason: `强度 ${c.strength} 中段、四种可行都不可 ⇒ 按判定表走保留（标待定，等它自己转化）` }
}

export const HARD_FAIL_LIMIT = 5
export const SOFT_FAIL_TRIGGER = 2

export function failStreak(m) {
  const ev = (m?.evidence || []).filter(Boolean)
  let n = 0
  for (let i = ev.length - 1; i >= 0; i--) {
    if (ev[i].pass === false) n++
    else break
  }
  return n
}

export const ESCALATE_EXITS = [
  '① 改判据（brain_plan，会回 pending 并留痕）—— 判据：boundary_seq +1 且 status=pending',
  '② 缩小 claim（真子集，不是换说法）—— 判据：covers.claimVariables ⊂ 原集合',
  '③ dropped（brain_plan status=dropped + dropped_why ≥10 字）—— 判据：返回 ok',
  '④ 转人工（brain_terminate way=不可达 + missing=<外部条件>）—— 判据：返回 ok',
]

export function hybridGate(m, stalled) {
  const streak = failStreak(m)
  const lv = (n) => {
    if (n >= 4) return { level: 'L2', need: '必须 brain_contra op:"try"：说清属哪类矛盾、走哪手、欠什么（ACT_OWES 会逐项查）' }
    if (n >= 2) return { level: 'L1', need: '只需最轻两手之一：补观测（交 observed+where）或复核（交 rerun+diff）；不必做完整矛盾展开' }
    return { level: 'L0', need: '不用做矛盾分析，直接改' }
  }
  if (streak >= HARD_FAIL_LIMIT) {
    return { gate: 'ESCALATE', streak, ...lv(streak),
      reason: `硬上限：连续 fail ${streak} 次（≥${HARD_FAIL_LIMIT}）⇒ 不管软判断说什么，都该给出口了`,
      exits: ESCALATE_EXITS }
  }
  if (streak >= SOFT_FAIL_TRIGGER && stalled) {
    return { gate: 'ESCALATE', streak, ...lv(streak),
      reason: `连续 fail ${streak} 次 + 同类反复（软判断不看好）⇒ 按用户口径「连错两次就该给降级方案或转人工」`,
      exits: ESCALATE_EXITS }
  }
  if (streak >= SOFT_FAIL_TRIGGER) {
    return { gate: 'PASS', streak, ...lv(streak),
      reason: `连续 fail ${streak} 次，但软判断认为还在推进（未到硬上限 ${HARD_FAIL_LIMIT}）` }
  }
  return { gate: 'PASS', streak, ...lv(streak),
    reason: streak ? '连续失败 ' + streak + ' 次，未达触发条件' : '' }
}

export function deliveryLine(plan, tasks) {
  const all = deliveryAll(plan, tasks)
  const rows = Object.entries(all).filter(([, d]) => d.hasPlan)
  if (!rows.length) return null
  const parts = rows.map(([tid, d]) => `${tid} ${d.done}/${d.total}`)
  const left = rows.reduce((s, [, d]) => s + d.pending + d.failed, 0)
  const nb = rows.reduce((s, [, d]) => s + (d.blank || 0), 0)
  const nh = rows.reduce((s, [, d]) => s + (d.half || 0), 0)
  const nblk = rows.reduce((s, [, d]) => s + (d.blocked || 0), 0)
  const nd = rows.reduce((s, [, d]) => s + (d.dropped || 0), 0)
  return `交付进度：${parts.join(' · ')}；还差 ${left} 个里程碑。`
    + (nd ? `🗑 其中 ${nd} 条是**主动放弃**（dropped）—— 这是取舍，**不是完成**；放弃的理由写在各自的 dropped_why 里，别把它读成"绿了"。` : '')
    + (nblk ? `🚧 其中 ${nblk} 个**证据到顶**（缺的只有外部能给）⇒ brain_terminate 声明「不可达」并指名缺哪个外部条件，别空转。` : '')
    + (nb ? `其中 ${nb} 处**定义留空**（留空不是缺失，是挂到期；到期会催，按 ${TK.BLANK_FACTOR} 折进进度）。` : '')
    + (nh ? `${nh} 处只写了半张定义（缺的一半会被当成真定义引用）。` : '')
    + (left === 0 && nblk === 0 && nd === 0 ? '**全部里程碑已绿 ⇒ 按「交付物在哪、怎么验」收尾。**'
      : '里程碑没绿之前，**只报进度不构成完成**（进度是过程量，里程碑才是交付量）。')
}
