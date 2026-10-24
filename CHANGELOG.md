# Changelog

All notable changes to `dsh-outer-brain`.

版本说明原则：这里写**你遇到了什么、现在变成什么样、怎么自己验**。
**不写**设计推导与实现路径 —— 那些随注释一起留在作者侧。

---

## 0.1.8 — 2026-10-24

### 为什么发这一版

0.1.7 是用 10-22 的代码快照打的包，而作者的工作树已经走到 10-24：
**27 个文件 / 986 KB vs 26 个文件 / 528 KB**，每个代码文件都不一致。
所以装 0.1.7 的人拿到的是**旧机制**——缺少下面这些行为。

### 新增行为

**陪审现在能区分「证据不够」和「这一庭要的东西机制给不了」**

以前这两种情况都判 `fail`、都显示「证据不足（还能补）」，于是当事人会反复换脚本、
改判据，而问题根本不在证据上。现在多了一种判决 `overreached`：

| 判决 | 当事人该做什么 |
|---|---|
| `pass` | 交付 |
| `fail` | 补证据 |
| **`overreached`** | **别再补证据** —— 换判据 / 引用已完成的里程碑 / 缩小 claim |
| `topped` | 找具名承接者（缺的是外部条件） |
| `unclear` | 改写 `done_when`（判据本身含糊） |
| `unavailable` | 庭没开成，不挡交付，但记一次欠开庭 |

`overreached` 的判定依据是：这一庭的缺项**过半**属于「换条命令再跑 / 要非当事人取证 /
不依赖你的脚本」这类要求 —— 机制能执行命令，但命令得有人写。

**对账闸按上述五类分别提示，不再统一喊「还欠着」**

同一个「pending」现在会告诉你是哪一类欠法，以及该催谁。

**`overreached` 不计入失败连击**

同一条判据连续被 `overreached` 判多次，不会把连续失败数推向升档上限。

### 变更

- 代码树与作者工作树同步（26 个文件）。
- 剥离注释 **3,283 处**，体积 668,819 → 439,460 B（**-34%**）。
  剥离用词法解析完成，剥离前后各自解析一次，任何一步失败则该文件原样保留。
- 同步后重新接线「原则层」：`readPhilosophy()` 额外追加 `PHILOSOPHY.full.md` 的「甲 · 原则层」段。

### 修复

- `readPhilosophy()` 的返回里补回原则层（10 条道德经 × 毛选），此前只有判据层。

### 怎么自己验

```powershell
node --input-type=module -e "const m=await import('file:///<安装路径>/dsh-outer-brain/dsh/index.js?v='+Date.now());const r=m.readPhilosophy({});const ks=['反者道之动','道法自然','实事求是','矛盾论','实践论'];console.log('chars='+r.chars,'principles='+ks.filter(k=>r.text.includes(k)).length+'/5')"
```

期望输出：`chars=21077 principles=5/5`

### 包内容

39 个文件：26 个代码 + 8 个知识文档 + 双语文档 + 配置。

| 知识文档 | 作用 |
|---|---|
| `PHILOSOPHY.md` | 21 条判据（每轮注入） |
| `PHILOSOPHY.full.md` | 原则层原文（其「甲」段随注入附带） |
| `DESIGN-CORE.md` | 五层 / 十公理 / 地形（每轮注入） |
| `FORMAL-DEFS.md` | 矛盾与升维的严格定义（每轮注入） |
| `JUDGMENTS.md` | 判断台账：被推翻过的判断 |
| `METHODS.md` | 七手法与断点表 |
| `DERIVATION.md` | 判据的推导链 |
| `ASSUMPTIONS.md` | 预设与影响级别 |

---

## 0.1.7 — 2026-10-24

### 修复

补进 4 个被代码与文档指向、但此前不在包内的文件：`JUDGMENTS.md`、`METHODS.md`、
`DERIVATION.md`、`ASSUMPTIONS.md`。

此前 `PHILOSOPHY.md` 写着「先查 `JUDGMENTS.md`」，工具说明里也列着另外三个，
但装完一个都找不到 —— 路标指着空处。

---

## 0.1.6 — 2026-10-24

### 新增

`readPhilosophy()` 追加 `PHILOSOPHY.full.md` 的「甲 · 原则层」段。

此前 `PHILOSOPHY.md` 说「原则层见 `AGENTS.md`」，而那是作者自己的环境配置，
干净安装里没有 —— 于是判据层齐全、原则层为空。

---

## 0.1.5 — 2026-10-24

### 修复

四个注入文件与作者运行副本逐字节一致（sha256 前缀）：

```
PHILOSOPHY.md       08B98806C27E
DESIGN-CORE.md      F82F354500CD
FORMAL-DEFS.md      1F6CD609C871
PHILOSOPHY.full.md  47B5838BDE03
```

拼接后注入长度 **16,379 字符**，与作者会话收到的完全一致。

---

## 0.1.4 — 2026-10-24

### 新增

`PHILOSOPHY.full.md`、`DESIGN-CORE.md`、`FORMAL-DEFS.md` 进包（35 个文件）。

---

## 0.1.3 — 2026-10-24

### 修复

`PHILOSOPHY.full.md` 进包。0.1.0–0.1.2 的 `files` 白名单里一直漏着它。

---

## 0.1.2 — 2026-10-23

### 修复

- `PHILOSOPHY.md` 首次真正进入 tarball（0.1.1 的 31 个文件里没有它，
  所以每次安装都得到 `ok=false` / 「正文未加载」）。
- `repository` 字段指向改名后的仓库。

---

## 0.1.0 — 2026-10-23

首个公开版本。12 个工具、4 个已停用（`brain_enforce` / `brain_terms` /
`brain_question` / `brain_back`）。
