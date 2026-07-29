# AI Usage — CTF-GRID (Team 9)

How we used AI on this project, for transparency (as the course asks). This is the
curated narrative; the complete verbatim prompt log is in
[`AI-PROMPTS-raw.md`](AI-PROMPTS-raw.md) (61 prompts, extracted from the session
transcripts).

## Tool & method

- **Tool:** Claude Code — Anthropic's command-line AI assistant (chat-based, but it
  can read/write files in the repo and run commands like `node`, `git`, tests).
- **Model:** Claude Opus.
- **How we worked:** conversational and iterative. We (the humans) set the goals,
  made every design decision, reviewed each change, and ran/tested everything. The
  AI did analysis, wrote code, and explained trade-offs. Every feature was verified
  (golden-byte tests, headless bots, real two-machine runs over Tailscale/Radmin)
  and committed to Git — the commit history is the record of what landed.
- **Record:** Claude Code stores each session as a local `.jsonl` transcript, so we
  have the full prompt/response history. `AI-PROMPTS-raw.md` is extracted from those.

## What the AI did vs. what we decided

| The AI helped with | We decided / owned |
|---|---|
| Reviewing the protocol drafts, finding gaps/contradictions | Which game/protocol to build; adopting v3 binary |
| Writing the codec, server, bridge, client, tests | The architecture, ports, and every trade-off call |
| Explaining trade-offs (binary vs JSON, TCP vs WebSocket, discovery) | Rejecting MessagePack; 4-direction movement; fixed-point |
| Debugging the cross-team disconnects | Testing with other teams and reporting what broke |
| Ops: git setup, file transfer, docs | What to submit and when |

---

## Phase-by-phase

### 1. Protocol design & review
Asked the AI to analyze our draft protocol and reason about the architecture:
client vs. server, grid vs. continuous map, and transport. Key realization it
surfaced: **browsers can't open raw TCP/UDP**, so our JS/Phaser team needs a bridge
process. It reviewed the spec and produced concrete gap-fixes. We decided the
direction; it did the analysis and drafting.

### 2. Walking-skeleton demo (JSON)
Built the thinnest end-to-end slice first — server + bridge + a plain web page
showing live messages — to prove the communication path before any game logic. We
tested it **across machines** (Mac host ↔ Windows VM) over Tailscale. This de-risked
the hardest part (cross-machine, bridged comms) early.

### 3. Aligning to the class spec (v3 binary)
When the group's actual spec turned out to be **PRFC-CC8-2026 v3.0** (continuous
plane, **binary** wire format), we had the AI compare it to our grid draft and flag
that they were different games. We then discussed efficiency (binary vs. JSON vs.
MessagePack); we **rejected MessagePack** and committed to the group's v3 binary.
The AI wrote our proposed clarifications ([`protocolo/…enmiendas…`](protocolo/PRFC-VERSION-3-enmiendas-parte1.md)).

### 4. Implementation (Part 2), built and tested in slices
Each slice was written, tested headless, then committed:
- **Binary codec + golden-byte tests** — the interop foundation (`protocol.js`, `protocol.test.js`).
- **Server + game loop** — movement, flag pickup/steal, victory, 20 tps (`server.js`).
- **Bridge** — binary WS↔TCP relay (`bridge.js`).
- **Phase 1** — Phaser rendered client with snapshot interpolation (`web/`).
- **Phase 2** — lobby + host-controlled start + countdown.
- **Phase 3** — UDP server discovery (bridge does the broadcast for the browser).
- **Host/spectator view** — the server "shows the game" per §4, with Start/New-match controls; launch-time server naming.

### 5. Cross-team interop fixes (from real testing)
Playing against other teams exposed bugs we then fixed with the AI:
- Players were **kicked from the lobby** — our idle-timeout was dropping valid but
  silent clients (background-tab throttling, and other teams have no keepalive). Fix:
  disable the app idle-timeout, detect dead peers via **TCP keepalive** instead.
- Made the server a **tolerant reader** — never reject a join over the name; only
  send exactly what the spec defines. Principle: *strict in what we send, lenient in
  what we accept.*

### 6. Ops & documentation
Set up the Git repo and pushed it, transferred builds to the test VM (Taildrop),
produced the submission bundle, and wrote the technical docs
([`DOCUMENTATION.md`](DOCUMENTATION.md)) and this file.

---

*Verbatim prompts: [`AI-PROMPTS-raw.md`](AI-PROMPTS-raw.md). Code history: the Git log.*
