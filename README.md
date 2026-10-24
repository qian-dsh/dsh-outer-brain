# dsh-outer-brain

English | [中文](README.zh.md)

**A philosopher's way of thinking, made executable — dialectics and practice-testing instead of prompt-level discipline. Built to govern two things that get worse the longer an agent runs: hallucination and long-session drift.**

Most tools try to make the model *smarter*. This one doesn't. It gives the agent:

- **a way to think** — find the principal contradiction, refuse false dichotomies, let practice rather than rehearsal settle a claim;
- **a way to check itself** — a ledger, executable criteria, and outside review, so "done" is a fact rather than an assertion.

## Two failure modes, and why length makes them worse

An agent is bad at catching itself doing either of these:

| What goes wrong | How it shows up | What governs it |
|---|---|---|
| **Hallucination** | The ledger turns green and the summary reads well, but the deliverable does not exist. "Last time it was like this." "The conditions aren't right so I can't." | Criteria must **actually run a command and read the exit code**; evidence without a **receipt** (verbatim command / path / URL) carries zero weight; after the machine gate passes, a **jury of three non-communicating reviewers** rules by majority |
| **Long-session drift** | Twenty turns in, the agent is optimising something nobody asked for, or re-running the same command while calling it progress | The **contradiction tree** keeps the principal contradiction pinned so it cannot quietly migrate; `stalled` catches semantic circling while `spin` catches mechanical repetition (OR-ed together); overturned claims are **recorded** instead of silently forgotten |

## Install

### Option A — Desktop app (most users)

Open **Settings → Plugins**, find `dsh-outer-brain`, enable it.

### Option B — CLI profile (`web`, `tui`, …)

```sh
dsh plugin --profile web add dsh-outer-brain
```

> ⚠️ **This command alone does NOT mount the plugin.** `dsh plugin` forwards its arguments verbatim to pnpm — it only adds the package to that profile's `dependencies`. **Mounting is decided by `dsh.profile.bundles`.**

You must also add the package name to `dsh.profile.bundles` in the profile's `package.json`:

```jsonc
{
  "dependencies": {
    "dsh-outer-brain": "^0.1.0"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "dsh-outer-brain"
      ]
    }
  }
}
```

Without the `bundles` entry, the package installs cleanly, **nothing runs, and no error is raised** — it will look like the plugin is broken.

Then restart DSH.

> **It starts silent.** Say **"开机制"** (turn the mechanism on) to activate it, **"关机制"** to dismiss it. That is deliberate — a tool for catching bad work should not be watching you all the time.

## The 12 tools

| Tool | What it does |
|---|---|
| `brain_task` | Declare the task: your words + my reading of them + why this approach + the result I want |
| `brain_plan` | Delivery ledger: milestones, artifacts, **executable criteria**, definitions (is / not / limit) |
| `brain_verify` | Run the criteria (the mechanism really executes the command and reads the exit code) + convene the jury automatically |
| `brain_contra` | Contradiction tree: two paths reaching the same endpoint with different results (Φ≠0), with eight disposal moves |
| `brain_observe` | Evidence pool: claim / prior / expectation / observation / receipt, scored by likelihood ratio |
| `brain_settle` | End-of-round settlement: water level into history, hazards closed out, off-contract observations captured |
| `brain_status` | Current water level, alarms, outstanding debts |
| `brain_lift_check` | Lift criteria: is a proposed lift a real take, a fixation, or simply not liftable yet |
| `brain_dissolve` | Lift receipt: what became of the contradiction that was supposed to be resolved (dissolved / transformed / still there) — **see known limitations** |
| `brain_escalate` | Escalate: what I need / why I cannot do it myself / where I would resume from |
| `brain_terminate` | Termination declaration: achieved (list verifiable facts) / unreachable (name the missing condition) / redirected |
| `brain_boundary` | The mechanism's own boundaries: register the walls the mechanism itself ran into |

## Configuration

Most behavior is tunable in `cordis.patch.yml`. The key settings:

```yaml
enabled: true        # master switch: false ⇒ no tools registered, no injection
ledger: 'ledger'     # evidence never dies + time-decay applied on read
decay: 0.35          # time-decay rate
cap: 3               # max items handled per round
leanSelect: true     # withdraw only "topic-selection" nudges; criteria are untouched
jury:
  enabled: true
  maxTokens: 16384   # verdict JSON + long reasons need headroom; too small ⇒ truncated ⇒ unclear
```

The state file defaults to **DSH's working directory** (`process.cwd()`), which means a `.outer-brain-diag.log` and state JSON appear next to wherever DSH was started. Set `workDir` in `cordis.patch.yml` to pin them to a fixed location:

```yaml
workDir: '/path/to/outer-brain-state'
```

## Known limitations (0.1.0)

Three paths in this release do not work end to end. They are listed here rather than hidden, because the whole point of this plugin is that **advertised capabilities should exist**.

| Area | What breaks |
|---|---|
| `brain_dissolve` | Resolves the id against the task/question tree instead of the contradiction tree, so passing a contradiction id (e.g. `C0`) reports "node not found". Lift receipts cannot be closed through this tool in 0.1.0. |
| Unknown pool | `brain_settle` captures off-contract observations, but nothing is wired to `classify` / `absorb` / `reject` them. If any stay open past the water line, "achieved" becomes permanently unreachable. |
| `brain_terminate` | `blocked_evidence` is validated and echoed in the receipt, but is not persisted onto the milestone record. |

## Honest limits

- **This is an early 0.1.0 mechanism**, designed for single-machine personal use. It is not a substitute for a mature workflow.
- It **injects a system prompt** into your session and **intercepts some "done" claims**. That is how it works, not a side effect. Say "关机制" at any time to turn it off.
- The jury needs a model that supports structured output; a small `maxTokens` truncates verdicts, which looks like "vague criteria" but is really "the output never finished".
- The mechanism has its own defect history. One failure mode kept recurring during development: **the function was written, the unit test passed, but nobody called it** — it computed numbers that never reached a decision. Each case was fixed, and it proves one thing: **a tool can stop you from fooling yourself; it cannot stop itself.**

## License

MIT
---

## Changelog

每一版「改了什么、为什么改、怎么自己验」都在 [CHANGELOG.md](CHANGELOG.md)。
