# dsh-outer-brain

English | [中文](README.zh.md)

**Externalizes boundary-drawing, contradiction-surfacing, and evidence-based verification into a set of tools plus a workflow — built to counter three failure modes that agents are bad at catching in themselves: fake completion, spinning in place, and self-deception.**

It does not make the model smarter. It gives it a **ledger, executable criteria, and outside review**.

## The problem it solves

An agent is bad at catching itself doing these three things:

| Failure | Symptom | How this plugin counters it |
|---|---|---|
| **Fake completion** | The ledger turns green and the summary reads well, but the deliverable does not exist | Criteria must **actually run a command and read the exit code**; after the machine gate passes, a **jury of three non-communicating reviewers** rules by majority |
| **Spinning in place** | Constantly "making progress" — rewriting criteria, re-running the same command | `stalled` covers the semantic layer (the jury keeps asking for the same kind of thing); `spin` covers the mechanical layer (the same command over and over). The two are OR-ed together |
| **Self-deception** | "Last time it was like this", "the conditions aren't right so I can't" | The evidence pool requires a **receipt** (verbatim command / path / URL); evidence without one carries zero weight. A judgment ledger records **claims that were overturned** |

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
