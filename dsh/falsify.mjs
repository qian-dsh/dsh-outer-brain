
export function attack({ claim = '', doneWhen = {}, kind = 'cmd' } = {}) {
  const c = String(claim || '').trim()
  if (!c) return { ok: false, why: '没有 claim 可攻（空 claim 无所谓真假）', shots: [] }
  const shots = []

  if (kind === 'cmd' || doneWhen.cmd) {
    shots.push({
      angle: '同码异因',
      try: '构造一个**与 claim 无关**的失败，让命令同样非零退出（如故意传坏参数 / 掐掉超时 / 空目录）',
      ifHolds: '如果它也非零退出 ⇒ 退出码证明不了"claim 说的那个原因"',
    })
    shots.push({
      angle: '超时伪装成失败',
      try: '把超时调短，让它**跑到一半就退**（不是断言失败，是时间不够）',
      ifHolds: '如果同样退出码 ⇒ 那次"红"不是判据在红，是墙钟在红',
    })
    shots.push({
      angle: '空跑',
      try: '把被测对象换成空实现/桩（什么都不做），看判据是否仍绿',
      ifHolds: '如果仍绿 ⇒ 判据测的不是行为，是"跑过了"',
    })
  }

  shots.push({
    angle: '边界外输入',
    try: '喂一个**类型对但范围错**的输入（空数组 / 只有 1 条 / 全 null / 第 0 根 K 线）',
    ifHolds: '如果它崩或静默给默认值 ⇒ claim 覆盖的只是"正常路径"',
  })

  shots.push({
    angle: '顺序颠倒',
    try: '把两个本应先后的步骤对调，看判据是否仍绿',
    ifHolds: '如果仍绿 ⇒ 判据不关心顺序，而 claim 可能声称了顺序',
  })

  shots.push({
    angle: '二次执行',
    try: '同一条命令连跑两次，比结果（文件哈希 / 输出）',
    ifHolds: '如果第二次不同 ⇒ 它有隐藏状态，claim 里说的"每次都对"不成立',
  })

  const kw = [
    { re: /重试|retry|拉起|冷启动|有界时间/, add: {
      angle: '重试耗尽冒充失败',
      try: '把重试次数/总时长刚好卡在边界（如只重试 1 次就报错），看它是否仍算"可诊断的 failure kind"',
      ifHolds: '如果重试 1 次失败和重试 N 次失败给同一个 kind ⇒ claim 说的"有界重试"其实没被区分' } },
    { re: /标注|来源|自研|标准|冒充|caliber|source/, add: {
      angle: '冒充标准',
      try: '把平台结果**清空**但保留 label 字段，看页面是否仍显示"标准"',
      ifHolds: '如果仍显示标准 ⇒ "如实标注"只在数据存在时成立，缺数据时它会冒充' } },
    { re: /读数|数字|一致|对齐|同口径|口径/, add: {
      angle: '巧合一致',
      try: '换一个**数值不同但结构相同**的输入，看两边是否仍"一致"（可能只是都等于同一个常量）',
      ifHolds: '如果仍一致 ⇒ 那不是"对齐"，是"都取了同一个默认值"' } },
    { re: /页面|显示|渲染|画|图表|面板/, add: {
      angle: '桩渲染',
      try: '用空 canvas / 桩 DOM 跑同一条命令，看判据是否仍绿',
      ifHolds: '如果仍绿 ⇒ 判据测的是"代码跑过"，不是"画出来了"' } },
    { re: /重试|超时|在.*时间内|耗时/, add: {
      angle: '墙钟当断言',
      try: '对比"断言失败"和"超时退出"的输出，看判据能不能区分',
      ifHolds: '如果不能区分 ⇒ 退出码 1 证明不了是断言红，可能只是到点了' } },
  ]
  const hit = new Set()
  for (const k of kw) if (k.re.test(c) && !hit.has(k.add.angle)) { hit.add(k.add.angle); shots.push(k.add) }

  if (/判据|测试|自检|验证/.test(c)) {
    shots.push({
      angle: '判据自指',
      try: '把**判据自己**的输入改坏（改测试文件 / 改 fixture），看它会不会红',
      ifHolds: '如果不红 ⇒ 这条判据只测被测物，不测自己（原文：判断器本身需要被判断）',
    })
  }

  return {
    ok: true,
    claim: c.slice(0, 120),
    shots,
    note: '每条 shot 都要能**当场试一次**；试完把结果写回 evidence（`ifHolds` 成立 = claim 被削弱）',
  }
}

export function brief(res) {
  if (!res || !res.ok) return `⚠️ 证伪脑没跑：${res?.why || '未知'}`
  return `证伪脑给出 ${res.shots.length} 个攻击角度：${res.shots.map((s) => s.angle).join('、')}`
}
