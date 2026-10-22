
export const ESCALATE_STATE = 'escalated'

export function escalate(plan, id, o) {
  const m = plan?.milestones?.[id]
  if (!m) return { ok: false, why: `没有里程碑 ${id}` }

  const oo = o || {}
  const need = String(oo.what_i_need ?? '').trim()
  const why = String(oo.why_i_cant ?? '').trim()
  const resume = String(oo.resume_from ?? '').trim()

  const miss = []
  if (need.length < 4) miss.push('what_i_need（要什么资源，具体到对方能直接给）')
  if (why.length < 6) miss.push('why_i_cant（为什么自己搞不定，具体到缺的是这个）')
  if (resume.length < 4) miss.push('resume_from（拿到后从哪接）')
  if (miss.length) {
    return {
      ok: false,
      why: `向上报告要三样，缺 ${miss.length} 项：${miss.join('；')}。`
        + ' —— 少一样就变成「我做不到」的抱怨，而不是「给我这个就能继续」。',
    }
  }

  m.escalation = {
    at: new Date().toISOString(),
    what_i_need: need.slice(0, 300),
    why_i_cant: why.slice(0, 500),
    resume_from: resume.slice(0, 300),
  }
  m.prev_status = m.status
  m.status = ESCALATE_STATE
  m.updated_at = m.escalation.at

  return {
    ok: true, id, status: m.status, escalation: m.escalation,
    line: `↑ ${id} 已向上报告：要「${need.slice(0, 60)}」；拿到后从「${resume.slice(0, 120)}」接`,
    escalated_line: escalatedLine(plan),
  }
}

export function resumeEscalation(plan, id, who) {
  const m = plan?.milestones?.[id]
  if (!m) return { ok: false, why: `没有里程碑 ${id}` }
  if (m.status !== ESCALATE_STATE) {
    return { ok: false, why: `${id} 现在不是 escalated（是 ${m.status}），没什么可接的` }
  }
  m.status = m.prev_status || 'pending'
  m.resumed_by = String(who || '').slice(0, 120) || '(未说是谁)'
  m.resumed_at = new Date().toISOString()
  return {
    ok: true, id, status: m.status, resumed_by: m.resumed_by,
    line: `↩ ${id} 已接回（${m.resumed_by}），从「${m.escalation?.resume_from || '?'}」继续`,
    escalated_line: escalatedLine(plan),
  }
}

export function escalatedLine(plan) {
  const rows = Object.values(plan?.milestones || {}).filter((m) => m.status === ESCALATE_STATE)
  if (!rows.length) return ''
  const items = rows.map((m) => `${m.id}（要：${String(m.escalation?.what_i_need || '').slice(0, 30)}）`)
  return `↑ ${rows.length} 条在等资源：${items.join(' / ')}`
}
