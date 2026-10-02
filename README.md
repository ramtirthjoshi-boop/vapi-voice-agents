# Cold-call simulator — voice AI practice prospects

Two voice agents that behave like a real B2B phone gauntlet, so cold calls can be
rehearsed without burning real leads.

`Sarah` is a receptionist. She screens the caller, gives up as little as possible,
and decides whether to route the call onward. `Jack` is the owner and the actual
decision-maker — he only ever picks up a call that has already been transferred to
him, and he is busy, skeptical and protective of his time.

Run as a squad, the two compose into the thing that actually makes cold calling
hard: you have to earn your way past a gatekeeper before you get to pitch anyone
who can say yes.

## Why build it this way

Most voice-agent examples are agents that *help* you. These are deliberately the
opposite — the design goal is an agent that is difficult, in the specific ways a
real prospect is difficult. That turned out to be mostly a prompt-engineering
problem rather than a model problem, and most of the work is in the negative
constraints:

- **Role boundaries are stated as refusals.** "You are NOT customer support. You
  do NOT explain processes." Without these, a helpful-by-default model slides into
  answering the caller's questions, and the caller gets a free pass.
- **Jack never receives a direct call.** His prompt establishes that the call was
  transferred to him. This stops him from re-running the screening Sarah just did.
- **Every call ends in one of a fixed set of outcomes** rather than trailing off,
  so a practice session produces a result that can be judged — booked, declined,
  or not qualified.
- **Each agent opens cold.** Sarah's first line is a flat "How may I help you
  today?", Jack's is "Hi, Who's this?" — no setup, no context handed to the caller.

## Stack

| Layer | Choice |
|---|---|
| Orchestration, squads, call transfer | Vapi |
| Speech to text | Deepgram |
| Reasoning | OpenAI `gpt-4o-mini` (`gpt-4.1` on the earliest build) |
| Text to speech | ElevenLabs |

`gpt-4o-mini` is the deliberate pick over a larger model: in a phone call,
response latency reads as hesitation, and a prospect who hesitates stops feeling
like a prospect. The prompt carries the behaviour, so the cheaper, faster model
costs nothing in realism.

## What's in the repo

| File | Contents |
|---|---|
| `config/assistant.json` | 5 assistants — the Jack and Sarah builds, in the order they were developed |
| `config/squad.json` | the squad that chains Sarah to Jack |
| `config/tool.json` | 2 tools, including end-of-call handling |
| `config/phone-number.json` | empty — no number provisioned, calls run over the web widget |
| `config/workflow.json` | empty — call flow lives in Vapi squads and in n8n, not in Vapi workflows |
| `config/index.json` | manifest with object counts and the export timestamp |
| `export-vapi.js` | pulls all five Vapi endpoints and writes this directory |
| `wire-vapi.js` | sets the call-log webhook and outcome schema on every assistant |

The five assistants are kept rather than squashed to the final pair, because the
progression from a single agent to a two-agent squad with a transfer is the part
worth reading.

## Capturing the result of a call

A practice call is only useful if it leaves a record, so each assistant posts
its end-of-call report to an n8n webhook, which appends one row per call to a
Google Sheet: timestamp, which agent, how it ended, duration, outcome, the
reason behind it, caller turn count, recording URL and full transcript.

The outcome is not inferred by keyword-matching the transcript. Each assistant
declares an analysis plan with a closed schema ( /  / ,
plus a one-sentence reason), so Vapi returns the outcome as a typed field. When
Vapi returns no outcome the cell is left blank rather than guessed — a blank row
is a known unknown, a guessed one is a wrong number that looks like data.

 applies the webhook, the shared secret and the analysis plan to
every assistant in one pass. The webhook URL is passed in through the
environment and deliberately not committed: the endpoint accepts
unauthenticated POSTs, so publishing its address would let anyone write rows
into the log.

## Current limits

Stated plainly, since they are the next things to build:

- **No scoring.** A call now ends with a recorded outcome, but not with a
  judgement of how the caller got there. Turn count and duration are logged as
  the raw material for that.
- **Prompts use a placeholder company (XYZ).** Pointing the agents at a
  specific industry would make objections concrete instead of generic.
- **Web calls only.** No provisioned phone number, so there is no real PSTN leg.
- **The log webhook is open.** Vapi sends a shared secret and the n8n side can
  check it, but until that value is filled in the endpoint trusts any caller.

## Re-exporting

```powershell
$env:VAPI_API_KEY = Read-Host "Paste Vapi private key"
node export-vapi.js
```

Credential-shaped fields are replaced with `<SCRUBBED>` before anything is
written, so this repo holds prompts and configuration but no secrets. Note that
this matches on field *names* — a key pasted into some other field, such as a
custom header on a tool, would survive it. Check a fresh export before committing.

## Restoring

There is no bulk import. Re-create each object with a POST to the matching Vapi
endpoint, dependencies first: `/tool`, then `/assistant`, then `/squad`. The `id`
fields in these files belong to the old objects and cannot be reused.
