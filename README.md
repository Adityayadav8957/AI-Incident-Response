# AI Incident Response

An AI agent that investigates production incidents before a human gets paged.

When an alert fires, it pulls the relevant logs and recent deploys, forms a
hypothesis about the root cause, and posts a structured incident report to
Slack with a suggested fix. A human approves or rejects it; on approval, the
system re-checks that the incident is still actually happening, then executes
a specific, pre-approved remediation action -- never an arbitrary command the
model invented on its own.

```
Alert  →  Investigation agent  →  Incident report (Slack)  →  Human approval  →  Remediation
          (logs + deploy history)   (root cause, confidence,
                                      evidence, suggested fix)
```

## Why

Most "AI SRE" demos are a chatbot wrapped around an LLM call. The interesting
part isn't the LLM call -- it's the plumbing and the guardrails around it:
getting the right context into the model reliably, capping how much damage a
wrong conclusion or a stuck loop can do, and never letting the model execute
something it invented on the spot. This project is built in two phases for
that reason:

- **Phase 1 -- read-only investigation.** The agent only ever reads logs and
  deploy history. It cannot take any action.
- **Phase 2 -- human-approved remediation.** The agent can suggest a fix, but
  only from a small, explicit allow-list of actions, and only a human can
  trigger it.

Auto-remediation without a human in the loop is a deliberately unbuilt
Phase 3 -- see [Roadmap](#roadmap).

## How it works

1. An alert (or, right now, a manual API call) describes an incident.
2. The agent runs a tool-calling loop against Claude: it can call
   `search_logs` (queries Elasticsearch) and `get_recent_deploys` (queries
   GitHub for commits touching the affected service), iterating up to 8 times.
3. It must finish by calling `submit_incident_report` -- a forced tool call
   with a fixed schema (summary, root cause, confidence, evidence, an
   `insufficientEvidence` flag, and optionally one of a small enum of known
   remediation action ids). This keeps the output shape reliable and gives
   the model an explicit way to say "I don't have enough evidence" instead of
   guessing.
4. The report is posted to Slack as a message with Approve/Reject buttons.
5. On **Approve**: the system re-checks the actual error rate before doing
   anything (an approval clicked minutes later could be acting on a situation
   that already resolved itself), then runs the named action and reports the
   result back into the same Slack thread.
6. On **Reject**: nothing runs; the decision is recorded.

## Tech stack

| Layer | Choice |
|---|---|
| Language | TypeScript / Node.js (single language across the stack) |
| Agent reasoning | Claude (Anthropic API), tool-calling loop, no agent framework |
| Logs | Filebeat → Elasticsearch (self-hosted via Docker) |
| Deploy history | GitHub REST API |
| Alert intake / approvals | Fastify + Slack (Block Kit, signed interactions) |
| Demo target | A small Fastify app with a `/admin/bug-mode` toggle that simulates a bad deploy |

No agent framework (LangChain, etc.) -- the investigation loop is a plain
`while` loop against the Anthropic SDK. At this scale, a framework would hide
exactly the parts (iteration caps, forced final tool, error handling per
tool call) that needed the most care.

## Repo structure

```
apps/demo-app/       Flaky checkout service used to generate realistic incidents
services/agent/      The investigation loop: search_logs, get_recent_deploys,
                      submit_incident_report tools; exported as `agent` for
                      other services to import
services/api/        Fastify server: alert intake, Slack posting, signed
                      interaction handling, remediation execution
filebeat/             Log shipping config
docker-compose.yml    demo-app + Elasticsearch + Kibana + Filebeat
```

## Running it locally

Requires Docker and Node 20+.

```bash
npm install
docker compose up -d --build     # demo-app, Elasticsearch, Kibana, Filebeat

# generate some traffic, including a simulated bad deploy
curl -X POST localhost:3300/admin/bug-mode -H "Content-Type: application/json" -d '{"enabled": true}'
for i in $(seq 1 15); do curl -s -o /dev/null localhost:3300/api/checkout; done
```

Run the agent directly from the CLI (needs `ANTHROPIC_API_KEY`):

```bash
cd services/agent
cp .env.example .env   # fill in ANTHROPIC_API_KEY
npm run dev -- "Elevated 500 error rate on /api/checkout"
```

Run the full API + Slack flow (additionally needs a Slack app -- bot token
with `chat:write`, an Interactivity request URL pointed at
`/slack/interactions` via something like ngrok for local testing, and the
signing secret):

```bash
cd services/api
cp .env.example .env
npm run dev

curl -X POST localhost:4400/alerts -H "Content-Type: application/json" \
  -d '{"description": "Elevated 500 error rate on /api/checkout"}'
```

## Design decisions worth calling out

- **Forced final tool call, not free text.** The model must call
  `submit_incident_report` to finish, with a JSON schema Claude has to fill
  in. This is far more reliable than parsing a paragraph, and it makes
  "insufficient evidence" a first-class, explicit output instead of something
  the model has to remember to mention.
- **Remediation actions are an enum, not a string.** `suggestedActionId` in
  the report schema is constrained to a fixed list. The model can describe a
  fix in prose, but it can only ever *trigger* one of a small number of
  pre-built, reviewed actions (`services/api/src/remediation.ts`).
- **Stale-approval revalidation.** Approving in Slack doesn't mean "run the
  action" -- it means "re-check whether this is still happening, then decide."
  If the error rate already dropped by the time someone clicks Approve, the
  action is skipped and that's recorded, rather than blindly executing
  against a situation that no longer exists.
- **Double-submission guard.** An incident that's already been decided
  ignores further button clicks, so a double-click or a duplicate Slack
  delivery can't run remediation twice.
- **Iteration cap.** The investigation loop is capped at 8 tool calls; on the
  last iteration, the model is forced to submit a report instead of
  continuing to search indefinitely.
- **Static log input over Docker autodiscovery.** Filebeat 8.15's
  hints-based Docker autodiscovery has a bug where its hint templates
  reference a Kubernetes-only field and silently produce zero inputs. Rather
  than fight it, log shipping uses a plain `container` input that tails all
  container logs directly -- simpler and more explainable than the "smarter"
  approach that didn't actually work.

## Roadmap

- Move incidents from in-memory storage to Postgres so they survive a
  restart, and to build a real audit trail (who approved what, when, with
  what evidence).
- Alert dedup/correlation so one root cause doesn't trigger dozens of
  parallel investigations.
- A queue (BullMQ + Redis) between alert intake and investigation, so a slow
  investigation can't block the webhook receiver.
- More remediation actions, each individually reviewed and scoped.
- Phase 3: narrow, customer-opted-in auto-remediation for specific,
  low-risk, pre-approved conditions -- everything else stays human-approved.
