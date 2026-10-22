
export const TERMS = {
  取: {
    is: '对还没定论的事先给一个说法，并承担它可能是错的。它是**可以错的选择**，不是事实。',
    not: '不管已经被可执行判据证实的东西（那叫事实，不叫取）；也不管"随便说说"（不承担错的，不是取）。',
    falsify: '若某个"取"永远无法被任何证据推向任何一边 ⇒ 它不是取，是**装饰**，该删。',
    例: '上一轮把「升维」实现成「替换(void)」、被点破应是「包含」——取错了能改，就是「取」的全部意义（DEFECTS 第 44 条）。',
    rev: [{ v: 1, at: '2026-10-18', why: '初版。用户第二次重申「每一句话都是取」。' }],
  },

  定义: {
    is: '说清"这个词/这件事成的时候是什么样"的一句话，且拿一个具体例子能判是或不是。它自身是一条取。',
    not: '不是把原话重说一遍（复述不是定义）；不是"做了什么动作"（动作不是状态）；不要求穷尽（只要求边界说得清）。',
    falsify: '若一个"定义"写出来后，任何例子都能同时满足它和它的反面 ⇒ 这定义没边界，等于没定义。',
    例: '同一个「升维」曾在 10 份 md 里各有私下定义、改时无唯一处可改，直到收进 terms.mjs——定义要唯一，否则口径裂。',
    rev: [{ v: 1, at: '2026-10-18', why: '初版。用户：「这个所谓的定义，就是取啊。」' }],
  },

  边界: {
    is: '这条规则/这个词**不管**什么，以及它**什么时候失效**。边界本身就是取（预期），要靠实证改。',
    not: '不是"适用范围越窄越安全"（把边界缩到只剩自己经历过的那一种情况，等于放弃这条规则的作用）。',
    falsify: '若一条边界从来没被任何证据改过 ⇒ 它是换包装的教条，不是边界。',
    例: '真机用「开在第几轮」当边界去判升维的包含关系，判出反方向——边界取错了量（时间先后 ≠ 范围大小，判据 30）。',
    rev: [{ v: 1, at: '2026-10-18', why: '初版。用户：「说"必须"的时候没有边界，是不是在耍流氓？而这个边界也是假的，这个边界就是预期。」' }],
  },

  意象: {
    is: '用一个熟悉形状去指向一个还没定死的东西，**允许被重定义**。它只在"帮人第一次看懂"时有用。',
    not: '不能当判据用（意象无从判定）；不能当术语的唯一身份（一旦要落地，必须换成可判定的定义）。',
    falsify: '若某个意象在落地时被发现指了两种互斥的东西 ⇒ 它该被拆成两条定义，而不是继续用一个词盖住。',
    例: '「升维/降维」只是意象，我曾把它钉成死术语、连写「必须」，被三次指正「它也可以被重新定义」。',
    rev: [{ v: 1, at: '2026-10-18', why: '初版。用户点破「降维升维只是一个意象而已，它也可以被重新定义」。' }],
  },

  升维: {
    is: '**意象**（不是判据）。当前用法：把一条具体矛盾上升到它所侵犯的那条不变量/哲学判断，'
      + '从而让处置办法从"这次怎么办"变成"这类事怎么办"。',
    not: '不等于"多加一个变量"（那是同一层的扩展，抽象层没动 —— 盘上 LIFT 原来就是这么实现的，已判为错）；'
      + '不等于"想得更大"这种无对象的说法。',
    falsify: '若升维之后，处置办法对"下一次遇到同类矛盾"没有任何可复用之处 ⇒ 这次是加变量，不是升维。',
    例: '自己想不出来时「去看别人怎么做」就是升维的 source——去当前层之外借一个已被验证的结构，而非凭空编（from_air）。brain_lift_check 四招 ladder/restate/separate/counter 全是借自别人（abstraction laddering / CPS / TRIZ / 最小反例法）。',
    rev: [
      { v: 1, at: '2026-10-18', why: '初版。此前 LIFT 的判据是「本轮新增了变量」，抽象层没动，被用户点破。' },
      { v: 2, at: '2026-10-18', why: '补明「它是意象，不是判据」—— 用户第三次指正：意象可以被重定义，别把它钉成死术语。' },
    ],
  },

  降维: {
    is: '**意象**（不是判据）。当前用法：把一条哲学判断落成一处具体的节点控制（控在哪一步、判据是什么、怎么区分、为什么这样）。',
    not: '不等于"把问题拆成子任务"（那拆的是范围，抽象层没动 —— 盘上 SPLIT 原来就是这么实现的，已判为错）；'
      + '不等于"降低要求"。',
    falsify: '若降维产出的规则答不出"它错了会看到什么" ⇒ 落下来的不是控制，是措辞。',
    例: '把「升维=包含不是替换」这条哲学判断，落成 layer.mjs 的 isSuperset 判据（边界严格变大才算升）——哲学落成一处能判真假的节点控制，就是降维。',
    rev: [
      { v: 1, at: '2026-10-18', why: '初版。此前 SPLIT 是"拆子问题"，与升维同层并列，不是一上一下。' },
      { v: 2, at: '2026-10-18', why: '补明「它是意象，不是判据」。' },
    ],
  },

  留空: {
    is: '该表态的地方明确说"现在给不出"，并标出空的是哪一段、为什么、什么条件下回来填。'
      + '它是**表过态的**（有账、有到期），不是没表态。',
    not: '不等于"没填"（没填是没有态，留空是有态 —— 两者在盘上必须分得开）；'
      + '不等于"免罪"（折分 + 挂到期，到期会催）；不等于"以后再说"（触发要指向盘上真有的东西）。',
    falsify: '若一条留空的记录从来没被它的 revisit 触发过、也从来没被填上 ⇒ 它不是留空，是被遗忘：'
      + '该换成更近的触发，或者承认这块根本不打算做（那就不是留空，是删）。',
    例: '陪审的 provider/model 至今「未钉住」，宁可留 null 不许猜（判据 19），而不是编一个像样的值填上。',
    rev: [{
      v: 1, at: '2026-10-18',
      why: '新增。用户第三次强调「不确定的地方就留空，没探索过的地方又不是没有给这个选项」，'
        + '并点破我此前只有"填齐 or 拒收"两条路 —— 而那条路逼出来的是编造（DEFECTS 第 39 条）。',
    }],
  },

  口径: {
    is: '一个累计值是哪套判据算出来的。判据一改，口径就变，旧累计**不可比**。',
    not: '不管"数据源换了"（那是数据版本，另记）；也不管纯事实计数（"发生过几次"与判据无关）。',
    falsify: '若某个数在判据改写后必然变成另一个数 ⇒ 它是判据产物；若不变 ⇒ 事实计数。用来分类。',
    例: '还债率分母从「open+settled」改成「open+settled+absorbed」后旧累计不可比——判据一改，旧数作废留痕，事实计数不动。',
    rev: [{ v: 1, at: '2026-10-18', why: '初版。两盏假红灯（stiffRounds=17 / aimBadRounds=18）是旧口径不清算造成的。' }],
  },

  代价: {
    is: '说错了、做错了、承诺了没还，会**当场损失**的那件东西（可核：命令红、账上欠、被拒收、用户看到差）。',
    not: '不是"我知道我错了"（自述不构成代价）；不是"下次注意"（无损失）。',
    falsify: '若一条约束被违反时，盘上没有任何东西变红、没有任何账变欠 ⇒ 它不是约束，是措辞。',
    例: 'agent 说「预算到顶」就停，交付账照样欠着——停本身不当代价，账上还欠着才是代价。',
    rev: [{ v: 1, at: '2026-10-18', why: '初版。全项目唯一职能「把代价接回决策」。' }],
  },

  判据: {
    is: '一条**能红**的可执行检查：跑起来有退出的 0/非 0，或验得出一条路径在不在。',
    not: '不是"看起来对不对"（那是模型判模型）；不是"我认为完成了"（自述不是判据）。',
    falsify: '若一条判据从没红过、也不可能红 ⇒ 它是装饰。真机 M1/M2 同一条命令判绿两件不同的话，就是这种。',
    例: 'M1/M2 两条不同里程碑用同一条命令、同一个退出码 0 判绿——那条判据从没红过，是装饰不是判据。',
    rev: [{ v: 1, at: '2026-10-18', why: '初版。' }],
  },
}

export function versionOf(term) {
  const t = TERMS[String(term)]
  if (!t) return null
  const r = (t.rev || [])
  return r.length ? Number(r[r.length - 1].v) || null : null
}

export function lookup(term) {
  const k = String(term ?? '').trim()
  if (!k) return null
  const t = TERMS[k]
  if (!t) return null
  return { term: k, is: t.is, not: t.not, falsify: t.falsify, 例: t.例 || null, v: versionOf(k) }
}

export function redefine(term, { is, not, falsify, why, at = null }) {
  const k = String(term ?? '').trim()
  const cur = TERMS[k]
  if (!cur) {
    return { ok: false, why: `术语「${k}」没登记过 —— 新词要走 register()（先答三问再进来），不能靠 redefine 凭空造` }
  }
  const w = String(why ?? '').trim()
  if (!w) {
    return { ok: false, why: `改术语「${k}」必须给 why —— 改定义不说为什么，就是悄悄换口径（和改判据同一条）` }
  }
  const nIs = String(is ?? cur.is).trim()
  const nNot = String(not ?? cur.not).trim()
  const nFal = String(falsify ?? cur.falsify).trim()
  if (!nIs) return { ok: false, why: `术语「${k}」的新定义 is 不能为空` }
  if (!nNot) {
    return { ok: false, why: `术语「${k}」的新定义缺 not（它不管什么）—— `
      + '没有边界的定义比旧定义更坏：旧边界至少被用错过、知道疼' }
  }
  if (!nFal) {
    return { ok: false, why: `术语「${k}」的新定义缺 falsify —— 什么证据会推翻它？答不出就不算可重定义，只是换了个说法` }
  }
  if (nIs === String(cur.is).trim() && nNot === String(cur.not).trim() && nFal === String(cur.falsify).trim()) {
    return { ok: false, why: `术语「${k}」新旧定义完全一样 —— 这不算一次重定义，只会把版本号灌水` }
  }
  const v = (versionOf(k) || 0) + 1
  const prev = { is: cur.is, not: cur.not, falsify: cur.falsify, v: versionOf(k) }
  TERMS[k] = {
    is: nIs, not: nNot, falsify: nFal,
    例: cur.例 || null,
    rev: [...(cur.rev || []), { v, at: at || null, why: w, prev }],
  }
  return { ok: true, term: k, v, prev, why: `「${k}」重定义为 v${v}：${w}` }
}

export function register(term, { is, not, falsify, why, at = null, 例 = null }) {
  const k = String(term ?? '').trim()
  if (!k) return { ok: false, why: '术语名不能为空' }
  if (TERMS[k]) {
    return { ok: false, why: `术语「${k}」已登记（v${versionOf(k)}）—— 改它走 redefine()，带 why 与旧值留痕` }
  }
  if (!String(is ?? '').trim() || !String(not ?? '').trim() || !String(falsify ?? '').trim()) {
    return { ok: false, why: `新术语「${k}」必须答三问：is（指什么）/ not（不管什么）/ falsify（什么会推翻它）` }
  }
  if (!String(why ?? '').trim()) return { ok: false, why: `新术语「${k}」要写 why（为什么需要这个词，不能复用已有的哪个）` }
  TERMS[k] = {
    is: String(is).trim(), not: String(not).trim(), falsify: String(falsify).trim(),
    例: String(例 ?? '').trim() || null,
    rev: [{ v: 1, at: at || null, why: String(why).trim() }],
  }
  return { ok: true, term: k, v: 1 }
}

export function audit() {
  const out = []
  for (const [k, t] of Object.entries(TERMS)) {
    const missing = []
    if (!String(t.is || '').trim()) missing.push('is')
    if (!String(t.not || '').trim()) missing.push('not')
    if (!String(t.falsify || '').trim()) missing.push('falsify')
    if (missing.length) out.push({ term: k, missing })
  }
  return out
}

export function termsIn(text) {
  const s = String(text ?? '')
  return Object.keys(TERMS).filter((k) => s.includes(k))
}
