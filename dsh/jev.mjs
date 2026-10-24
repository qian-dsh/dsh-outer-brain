
export const ENDPOINT = process.env.LAYA_ENDPOINT || 'http://127.0.0.1:8000/v1/systemone'
export const MODEL = process.env.LAYA_MODEL || 'laya-multilingual'
export const CTX_LIMIT = 1024

export const ROUTE = Object.freeze({ ACT: 0.85, LLM: 0.60 })

export const ACTION = Object.freeze({
  AUTO: 'AUTO_EXECUTE',
  LLM: 'FALLBACK_LLM',
  HUMAN: 'ESCALATE_HUMAN',
})

export function route(strength) {
  const s = Number(strength)
  if (!Number.isFinite(s)) return { action: ACTION.HUMAN, why: '把握不是数 ⇒ 升级人工（不许猜）' }
  if (s >= ROUTE.ACT) return { action: ACTION.AUTO, why: `把握 ${s.toFixed(3)} ≥ ${ROUTE.ACT} ⇒ 自动执行` }
  if (s >= ROUTE.LLM) return { action: ACTION.LLM, why: `把握 ${s.toFixed(3)} ∈ [${ROUTE.LLM},${ROUTE.ACT}) ⇒ 交 LLM 兜底` }
  return { action: ACTION.HUMAN, why: `把握 ${s.toFixed(3)} < ${ROUTE.LLM} ⇒ **升级人工/追问用户**（这就是"该问"的信号）` }
}

export function checkQuestions(questions) {
  const bad = []
  const qs = questions && typeof questions === 'object' ? Object.entries(questions) : []
  if (!qs.length) return { ok: false, bad: ['没有 questions（至少一个）'] }
  for (const [k, q] of qs) {
    if (!q || typeof q !== 'object') { bad.push(`${k}: 不是对象`); continue }
    if (!['noul', 'choice', 'score'].includes(q.type)) bad.push(`${k}: type 必须是 noul/choice/score`)
    if (q.type === 'choice') {
      const c = q.criteria
      if (!c || typeof c !== 'object' || Object.keys(c).length < 2) bad.push(`${k}: choice 要有 ≥2 个 criteria（否则无处可选）`)
    }
    if (typeof q.instructions !== 'string' || !q.instructions.trim()) bad.push(`${k}: 缺 instructions`)
  }
  return { ok: bad.length === 0, bad }
}

const DEFAULT_DEGRADED = Object.freeze({
  answers: {}, usage: null, degraded: true, action: ACTION.HUMAN,
  why: '降级（服务没起/超时/响应不合规）⇒ 升级人工，不阻塞',
})

export async function decide({ state, questions, timeoutMs = 8000 } = {}) {
  const qc = checkQuestions(questions)
  if (!qc.ok) return { ...DEFAULT_DEGRADED, why: `questions 不合规：${qc.bad.join('；')}` }
  const s = String(state || '').trim()
  if (s.length < 2) return { ...DEFAULT_DEGRADED, why: 'state 为空 ⇒ 没有依据，不许判' }

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  let body
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, state: s, questions }),
      signal: ctl.signal,
    })
    if (!r.ok) return { ...DEFAULT_DEGRADED, why: `服务返回 HTTP ${r.status}` }
    body = await r.json()
  } catch (e) {
    return { ...DEFAULT_DEGRADED, why: `调用失败：${String(e.message || e).slice(0, 80)}` }
  } finally {
    clearTimeout(timer)
  }

  const usage = body?.usage || null
  if (usage && (usage.truncated || (usage.state_tokens || 0) > CTX_LIMIT)) {
    return { ...DEFAULT_DEGRADED, answers: body?.answers || {}, usage, why: `state 超上下文（${usage.state_tokens}/${CTX_LIMIT} token 或 truncated）⇒ 这次判断不采信` }
  }

  const answers = body?.answers || {}
  if (!Object.keys(answers).length) return { ...DEFAULT_DEGRADED, usage, why: '服务没给 answers' }

  const confs = Object.values(answers).map((a) => Number(a?.confidence)).filter((n) => Number.isFinite(n))
  const strength = confs.length ? Math.min(...confs) : NaN
  const rt = route(strength)
  return { answers, usage, strength, action: rt.action, why: rt.why, degraded: false }
}

export function brief(dec) {
  if (!dec || dec.degraded) return `⚠️ 决策层降级：${dec?.why || '未知'}`
  const parts = []
  for (const [k, a] of Object.entries(dec.answers || {})) {
    if (a.type === 'noul') parts.push(`${k}=${Number(a.noul).toFixed(2)}`)
    else if (a.type === 'choice') parts.push(`${k}=${a.choice}(${Number(a.answer_confidence).toFixed(2)})`)
    else if (a.type === 'score') parts.push(`${k}=${Number(a.score ?? a.value ?? NaN).toFixed(2)}`)
  }
  return `${dec.action}｜把握 ${Number(dec.strength).toFixed(3)}｜${parts.join(' ')}｜${dec.why}`
}
