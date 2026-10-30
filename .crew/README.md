# The crew: agent SDLC for this repo

Six Claude Code agents run a change from request to release pack, modelled on a launch team.
Two controls are plain code, not AI, so they can't be talked out of a decision. A human signs off.

| Role | File | Owns | Can't |
|---|---|---|---|
| Chief of Staff | `.claude/agents/chief-of-staff.md` | Runs the mission, dispatches roles, tracks status | Write code or approvals |
| Chief Engineer | `.claude/agents/chief-engineer.md` | Questions the request, design, acceptance criteria, ADR | Write code |
| Responsible Engineer | `.claude/agents/responsible-engineer.md` | Builds the change + unit tests | Touch acceptance tests, guardrails, push |
| Test Engineer | `.claude/agents/test-engineer.md` | Independent acceptance tests from the spec only | Edit source; read the builder's tests or reasoning |
| Security Engineer | `.claude/agents/security-engineer.md` | Reviews the diff, can block | Write anything |
| Launch Director | `.claude/agents/launch-director.md` | Go/no-go poll, release pack | Push or deploy |
| **Range Safety** (code) | `.claude/hooks/range-safety.js` + `.crew/policy.json` | Blocks any tool call that breaks policy | — |
| **Flight Recorder** (code) | `.claude/hooks/flight-recorder.js` | Tamper-evident log of every action and flight card | — |
| **Flight Director** (you) | `approvals.md` in each mission | Approves the design, pushes, merges, deploys | — |

## Run a mission

Interactive, on your machine:

```bash
claude --agent chief-of-staff
> Mission: <describe the change>
```

The Chief of Staff opens `.crew/missions/<MISSION-ID>/`, gets a design from the Chief Engineer, then **stops**.
Read `design.md`. If you agree, create `approvals.md` in that folder:

```
DESIGN: APPROVED - <your name>, <date>
```

Then tell it: `Continue MISSION-ID <id>`. It runs build, test, security and the go/no-go poll, and hands you a release pack.
You review, push and open the PR.

Headless, in a disposable container or CI runner only:

```bash
claude --agent chief-of-staff -p "Mission: <change>" --permission-mode bypassPermissions
```

The hooks still block policy breaks in this mode.

## What each mission leaves behind

```
.crew/missions/<MISSION-ID>/
  mission.md          request, task table, status log
  design.md           problem, options, decision (ADR), acceptance criteria
  approvals.md        human sign-off (agents can't write this)
  flight-cards/       every role's report: verdict, why, evidence, risks, confidence
  go-no-go.md         Launch Director's station-by-station poll
  release-notes.md    the PR description
.crew/flight-recorder/<session>.jsonl   every tool call, block and flight card, hash-chained
```

Check the audit log hasn't been edited: `node .crew/bin/verify-recorder.js`

## What Range Safety enforces (see `.crew/policy.json`)

- **Least privilege per role**: each role has its own write paths and command list.
- **Maker ≠ checker**: the builder can't touch acceptance tests; the tester can't touch source or read the builder's work.
- **Human gate**: the builder can't start until `approvals.md` says `DESIGN: APPROVED`.
- **Hard limits**: 3 build cycles per mission, 400 tool calls per session.
- **No push, merge, deploy, network, new packages, or secrets** for any crew agent. No commits on `main`.
- **Guardrails protect themselves**: agents can't edit `.claude/`, the policy, the recorder or approvals.
- **Explainability**: an agent can't finish without a flight card (Verdict and Evidence lines).
- **Fails closed**: if the policy check errors, the action is blocked.

Prove it: `npm run test:crew` (12 tests against the real hook scripts).

## Honest limits

Hooks are guardrails, not a sandbox. They catch mistakes and most prompt-injection attempts,
but a determined process with shell access can find gaps (for example, a test script that writes files).
For production use, add OS-level isolation: run the crew in a container, give it a GitHub token
that can't push to `main`, and keep deploy credentials out of the environment entirely.
