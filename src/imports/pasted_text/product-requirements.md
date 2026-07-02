# Product Requirements Document: Dead and Wounded

**An online head-to-head number deduction duel — real-time multiplayer or vs AI — built for a single vibe-coding session**

---

## 0. What Changed From v1

Two updates from the previous draft: the game is now named **Dead and Wounded** (dropping the "DeadCode" working title), and the PvP mode is now **real online multiplayer** (two players on separate devices, matched by a shareable room code) instead of local pass-and-play on one device.

This is a meaningfully bigger technical lift than the local version — it needs a live backend, not just a single-page app — but it's still very achievable in one vibe-coding session if you pick the right stack (see §8). The core rules, scoring, and most of the UI/UX spec from v1 carry over unchanged; this doc folds those in and replaces the local hand-off flow with a proper online flow.

---

## 1. Executive Summary

Dead and Wounded is a real-time, turn-based deduction duel. Each player secretly picks a 4-digit code (0–9, no repeats). Players take turns guessing each other's code over the network; after each guess, the guesser is told how many digits are **dead** (right digit, right position) and **wounded** (right digit, wrong position) — never which ones. First to guess the opponent's full code (4 dead) wins instantly.

Two modes:
1. **Online Multiplayer** — create or join a match via a short shareable room code, play live against a real opponent on their own device, in real time.
2. **VS AI** — offline-capable, selectable difficulty (Easy / Medium / Hard), same core rules.

**Platform:** Web, mobile-first responsive, single-page app + lightweight realtime backend (see §8 for exact recommendation).

---

## 2. Goals

| Goal | Success signal |
|---|---|
| Matchmaking is frictionless | Two players can go from "let's play" to both codes locked and Player 1's first guess live in under 60 seconds |
| Nobody can ever see the opponent's secret | Client never receives the opponent's code until the game legitimately ends — enforced server-side, not just hidden in the UI |
| Feedback is instantly legible | "2 dead, 1 wounded" is understandable at a glance via color/iconography, no tutorial needed |
| Real-time state always feels current | Both players' screens reflect the true game state within ~1 second of any action, with no manual refresh ever required |
| Disconnects don't ruin the game | A player who briefly loses connection can rejoin the same match in progress without losing state |
| Ships in one build session | Achievable with a serverless realtime backend (no custom server to deploy/manage) — see stack recommendation |

---

## 3. Core Concepts & Rules (unchanged from v1)

### 3.1 The Secret Code
- 4 digits, each 0–9, no digit repeated. Total possible codes: `10 × 9 × 8 × 7 = 5,040`.

### 3.2 Scoring a Guess
- **Dead:** count of positions where `guess[i] == secret[i]`.
- **Wounded:** shared digits between guess and secret, at different positions — since no repeats, this is `(shared digit count) − dead`.

**Example:**
```
Secret:  3 7 0 9
Guess:   3 0 7 5
→ 1 Dead (the 3), 2 Wounded (7 and 0, both present but misplaced)
```

### 3.3 Turns & Win Condition
- Players alternate turns; each turn is one guess against the opponent's code, with an immediate Dead/Wounded result.
- First player to hit 4 Dead wins instantly — game ends immediately, does not wait for the opponent to catch up.
- Game over reveals both codes and full guess history for both sides.

---

## 4. Modes

### 4.1 Online Multiplayer (new — replaces local pass-and-play)

**Flow:**
1. **Home screen:** two options — "Create Match" and "Join Match."
2. **Create Match:** player enters a display name, taps Create → server generates a short, human-friendly **room code** (e.g., `4 characters, letters+digits, like "K7QX"` — short enough to read aloud or type quickly). Screen shows the code big and shareable (copy-to-clipboard button, and ideally a native share-sheet trigger on mobile), plus a "waiting for opponent..." state with a subtle pulsing animation.
3. **Join Match:** player enters a display name and types in the room code they received → tap Join.
4. Once both players are in the room, **both** transition automatically (no manual refresh) to the **Secret Code Setup** screen simultaneously.
5. Each player sets their own secret code privately, on their own device — there is no shared-screen risk anymore, so no hand-off interstitial is needed at all in this mode. This is actually simpler and safer than the local version.
6. Show a "waiting for opponent to lock in their code" state for whichever player finishes first — a small live indicator (e.g., "Opponent is choosing..." with an animated dot) reassures them the game hasn't stalled.
7. Once both codes are locked, the match begins. Randomly assign (or coin-flip animate) who guesses first — make this random assignment itself a small moment of drama (a quick animated coin-flip or dice-roll beat), not a silent backend decision.
8. **Turn-based live play:** it's always exactly one player's turn. The player whose turn it is sees an active guessing screen (per §5, Screen 5 from v1). The waiting player sees a **live spectator state**: their own guess history, a "waiting for [opponent name]..." indicator, and the moment the opponent submits a guess, the result animates in for them too (since it's *their* code being guessed against) at the same time it does for the guesser. Both players should feel like they're watching the same live event, just from different seats.
9. First to 4 Dead wins → both players see the Game Over screen simultaneously, in real time.

**Reconnection handling (important for online play):**
- If a player's connection drops mid-match, the other player sees a clear "Opponent disconnected — waiting to reconnect..." state rather than the game silently freezing or erroring.
- The disconnected player, on reopening the app, should be able to rejoin the same room (via a persisted room code, e.g., in localStorage) and resume exactly where the match left off — full guess history and current turn state restored.
- Add a reasonable timeout (e.g., 2 minutes) after which the connected player is offered a "Claim Win / Leave Match" option rather than waiting forever.

**Rematch flow:**
- After Game Over, either player can propose a "Rematch" — the other player sees a live prompt to accept, and if accepted, both are dropped back into a fresh Secret Code Setup screen in the *same room*, no need to re-share a room code.

### 4.2 VS AI (unchanged from v1, still fully client-side/offline-capable)
- Difficulty select: Easy / Medium / Hard.
- Player sets their own secret code privately; AI's code is generated randomly, never shown until game over.
- Turns alternate between player and AI, with an "AI thinking" beat between turns.
- See §6 (AI Design) for full behavior per tier — unchanged from v1.

---

## 5. UI/UX Design Spec

The visual style, screen inventory, and micro-interaction table from v1 all carry over — same "tactical/spy" dark UI direction, same Dead/Wounded pip-based history rows, same sequenced reveal animations. This section only covers what's **new or changed** for online multiplayer; treat it as additive to the v1 spec.

### 5.1 New/Changed Screens

**Screen A — Home / Mode Select (updated)**
- Title: "DEAD AND WOUNDED" in the monospace/display font with the terminal-boot flicker animation.
- Two primary paths: **"Play Online"** and **"Play vs AI"**.
- "Play Online" expands into the Create/Join choice (see below) rather than going straight into setup, since online mode needs a matchmaking step first.

**Screen B — Create or Join**
- Two large tappable cards: "Create Match" (generates a room) and "Join Match" (enter a code).
- Simple, low-friction — this should feel as fast as starting a video call, not like a account/login flow.

**Screen C — Room Code Display (Create Match)**
- Big, bold, monospaced room code display — styled like the secret-code slots for visual consistency (this game's whole identity is "codes"), e.g. large boxed characters.
- Copy button + native share button.
- "Waiting for opponent to join..." status with a subtle looping pulse/radar-style animation (fits the tactical theme nicely — think a radar sweep or signal-searching animation).
- Cancel button to back out and return home.

**Screen D — Enter Room Code (Join Match)**
- A code input styled to match the display in Screen C (same boxed-character look, so joining *feels* like slotting into someone else's transmission — nice thematic tie-in).
- Clear inline error state if the code doesn't match an open room ("Room not found" or "Room is full"), no dead-end — just let them retry.

**Screen E — Opponent Connected Transition**
- Brief full-screen beat when the second player joins: both players' names appear, a quick "connected" animation (e.g., two signal icons linking up, or a handshake-style visual), then auto-advance into Secret Code Setup for both simultaneously. This replaces the old local hand-off screen as the "moment the match officially begins."

**Screen F — Turn Indicator / Live Waiting State (in-match)**
- On the guessing screen, the header must make it unmistakably clear whose turn it is right now: e.g., a glowing "YOUR TURN" badge in the accent color when active, versus a calmer, dimmer "[Opponent]'s turn — waiting..." state with a subtle pulse when not.
- When it's not your turn, the digit keypad and submit button should be visibly disabled/dimmed (not just functionally blocked) so there's no confusion about whether input is expected.
- The instant the opponent submits their guess, their result should animate onto *your* screen in real time (since it's your code being probed) — this is one of the more important live-sync moments in the whole game and should feel immediate, not laggy.

**Screen G — Disconnect / Reconnect State**
- A clear, calm (not alarming) banner or overlay: "Opponent disconnected. Waiting for them to reconnect..." with a subtle timer or spinner.
- After the timeout window, surface the "Claim Win / Leave Match" choice as described in §4.1.

**Screen H — Rematch Prompt**
- On Game Over, a "Rematch" button sends a live request; the requester sees "Waiting for [opponent] to accept..."; the other player sees an incoming prompt with Accept/Decline. Keep this lightweight — a small modal, not a new screen.

### 5.2 Micro-interactions — additions for online mode

| Moment | Feedback |
|---|---|
| Room code generated | Characters "type on" one at a time (like a terminal printing output), not an instant paste |
| Opponent joins room | Brief connection/handshake animation (§ Screen E), plus a soft notification sound if audio is on |
| Turn passes to you | Screen header transitions from dimmed "waiting" state to glowing "YOUR TURN" state with a brief pulse/attention-grabbing animation — this is the cue that pulls the player's focus back to the app |
| Opponent's guess result lands on your screen | Same sequenced dead/wounded reveal animation as v1 (§5.3 in v1 doc), triggered by the incoming network event rather than a local submit |
| Connection lost | Banner slides in calmly (not a jarring red error flash — this is a normal occurrence in mobile networking, shouldn't feel like a bug) |
| Reconnected | Banner fades out, brief "back online" confirmation pulse |
| Rematch accepted | Quick transition wipe, same "connected" beat as initial match start |

### 5.3 Latency & "Liveness" Feel
The single biggest UX risk in an online version is the game feeling laggy, stale, or uncertain about whose turn it is. Concretely:
- Never let a player wonder "did my guess actually send?" — show an immediate optimistic local state change (e.g., button press feedback, guess appears in your own history right away) even before server confirmation returns, then reconcile if needed.
- Always show *some* live indicator of the opponent's presence/activity (even just "Opponent is online" vs "Opponent is offline"), so the game never feels like it's talking to a black box.
- Keep the AI "thinking" delay pattern from v1, but for online mode there's no need to fake a delay — real network latency will naturally provide that beat.

---

## 6. AI Design (VS AI mode — unchanged from v1)

### 6.1 Easy
Fully random valid guesses each turn, no real deduction, occasional lucky repeats of known-dead digits. Beatable, relaxed.

### 6.2 Medium
Tracks the full set of codes still consistent with all clues received so far; picks a **random member** of that remaining possibility set each turn. Smart but not optimal.

### 6.3 Hard
Same possibility-set tracking, but picks the guess that **minimizes the worst-case remaining possibility count** (simplified Knuth-style minimax) each turn. With only 5,040 total possible codes, this is trivially fast to brute-force client-side — typically solves a code in 4–6 guesses. Genuinely sharp opponent.

### 6.4 AI "Thinking" Delay
Cosmetic only — actual computation is instant. Insert artificial delay scaled to difficulty (Easy ~500ms, Medium ~800ms, Hard ~1.2s) so higher difficulty *feels* more deliberate.

---

## 7. Feature Scope

### MVP (build in this order)
1. `scoreGuess` / `isValidCode` pure functions (rules engine) — unchanged from v1, build and test first.
2. Secret Code Setup screen (digit slots, keypad, duplicate-blocking, lock animation) — reused across both modes.
3. **Online: Create Match** flow — generate room code, waiting state.
4. **Online: Join Match** flow — code entry, connect to room.
5. Realtime sync: both players' secret-code-lock states, turn state, guesses, and results all propagate live (see §8 for exact mechanism).
6. Guessing screen with live turn indicator (active vs waiting states).
7. Guess history rendering (digits + pips), synced for both players.
8. Win detection + simultaneous Game Over screen for both players.
9. Basic reconnection: rejoin a room via persisted room code, resume state.
10. VS AI mode, Easy tier, to validate the offline path still works end-to-end.
11. Mobile-responsive pass.

### Stretch (add if time remains)
12. Medium and Hard AI tiers (possibility-set tracking + minimax).
13. Rematch flow (in-room, no new code needed).
14. Disconnect timeout + "Claim Win" fallback.
15. Sequenced per-digit reveal animations, sound design, win fanfare — full micro-interaction polish from v1 §5.3.
16. Presence indicators ("Opponent is online/offline/typing their guess...").
17. Guess counter / "solved in N guesses" stat, shareable result card.
18. Spectator/rejoin-as-viewer if a match is already finished when someone opens an old room link.

### Explicit Non-Goals for MVP
- No accounts/login system — room codes are the entire identity mechanism, matches are ephemeral. (Optional stretch far beyond this doc: persistent profiles, if you want stats across matches later.)
- No matchmaking queue / random-opponent pairing — only direct room-code invites for MVP.
- No spectator mode for live in-progress matches (only rejoin-as-participant).
- No chat feature for MVP — keep the focus on the core duel loop.

---

## 8. Technical Recommendation (for vibe-coding)

This is the section that changes most from v1. A local-only game needs no backend at all; an online multiplayer game needs **some** realtime data layer, but you can avoid writing and hosting a custom WebSocket server, which is the part most likely to eat your whole build session.

**Recommended approach: a serverless realtime database, not a custom server.**

Use **Firebase Realtime Database (or Firestore with realtime listeners) or Supabase Realtime** — either works fine, pick whichever you're more comfortable wiring into a React app quickly. Both give you:
- A hosted realtime data store you can read/write from the client directly.
- Live subscriptions — any client watching a given "room" document gets pushed updates the instant another client writes to it, with no custom server process to build, deploy, or keep running.
- Free tiers generous enough for a game like this at hobby/demo scale.

This turns "online multiplayer" from a systems-engineering project into "read and write to a shared document," which is exactly what you want for a single vibe-coding session.

**⚠️ Important security note:** with a client-writes-directly-to-database approach, you must make sure a malicious or curious client **cannot simply read the opponent's secret code field**, even though it's sitting in the same room document. Two practical options, in order of recommended effort:
1. **Simplest (fine for MVP/hobby use):** store the opponent's secret code in the shared room document, but treat it as "hidden by convention" — the client UI simply never displays it, and you accept that a technically savvy player *could* open dev tools and peek. This is a reasonable tradeoff for a casual game between friends and is the fastest to build.
2. **More correct (worth doing if you have time, or if this ever goes public):** use a small serverless function (Firebase Cloud Function / Supabase Edge Function) as the only thing allowed to read secret codes and compute Dead/Wounded results — clients only ever send guesses to the function and receive results back, never touching the raw secret field directly. This closes the dev-tools-peeking gap entirely.

Start with option 1 to ship fast; upgrade to option 2 later if trust/integrity matters more than build speed for your use case.

**Suggested room document shape:**
```js
// realtime document at rooms/{roomCode}
{
  roomCode: "K7QX",
  status: "waiting" | "setup" | "playing" | "finished",
  createdAt: timestamp,
  players: {
    p1: { name: string, connected: boolean, secretCode: number[] | null, guesses: GuessEntry[] },
    p2: { name: string, connected: boolean, secretCode: number[] | null, guesses: GuessEntry[] }
  },
  currentTurn: "p1" | "p2",
  winner: "p1" | "p2" | null,
  rematchRequestedBy: "p1" | "p2" | null
}

// GuessEntry shape (unchanged from v1):
{ guess: number[], dead: number, wounded: number, timestamp }
```

**Client-side logic, largely unchanged from v1:**
- `scoreGuess(guess, secret)`, `isValidCode(digits)`, `randomValidCode()` — identical pure functions, still fully unit-testable in isolation.
- The AI possibility-set / minimax functions from v1 §8 are unchanged and only run client-side for VS AI mode.
- New: a thin realtime sync layer — subscribe to the current room document, write guesses/state changes to it, let the realtime database push the resulting updates to both connected clients.

**Room code generation:**
- Generate a short (4–6 character) alphanumeric code, check it isn't already an active room, retry on collision. Keep it human-friendly — avoid visually ambiguous characters (0/O, 1/I/l) if using letters+digits.

---

## 9. Suggested Build Order (a practical vibe-coding session plan)

1. Build `scoreGuess` and `isValidCode` as pure functions, sanity-check with console tests (unchanged from v1 — this never depends on networking).
2. Build the Secret Code Setup screen component (digit slots, keypad, duplicate-blocking) — used in both modes.
3. Stand up the realtime backend (Firebase or Supabase project, basic read/write to a test room document) — get "two browser tabs can see each other's writes live" working before building any game logic on top of it.
4. Build Create Match / Join Match flow, wired to real room creation/joining.
5. Wire Secret Code Setup to write into the shared room document; confirm both simulated players (two browser tabs) see each other's "locked" status live.
6. Build the Guessing screen with the turn-indicator active/waiting states, wired to read/write guesses through the room document.
7. Add guess history rendering, synced live for both sides.
8. Add win detection + simultaneous Game Over screen.
9. Add basic reconnection (persist room code locally, rejoin on reload).
10. Layer in VS AI mode (fully offline/client-side, reuses the Setup and Guessing screen components) — Easy tier first, then Medium/Hard.
11. Polish pass: micro-interactions, sequenced reveal animations, sound, the "connected" and "your turn" transition beats.
12. Mobile pass: real phone-sized viewport testing, especially the room-code sharing flow (copy/share button behavior on mobile).

Given the added networking complexity, it's worth treating step 3 (basic two-tabs-syncing-live) as a hard checkpoint before building anything else on top of it — if realtime sync isn't solid early, everything built after it inherits that risk.

---

## 10. Open Questions / Decisions for You

- Firebase or Supabase — any existing preference, or should we just pick one and go?
- Is "peek-able via dev tools" (option 1 in §8's security note) an acceptable tradeoff for launch, or do you want the Cloud Function approach from day one?
- Do you want room codes to expire after some time / after a match finishes, or persist indefinitely for casual rematches?
- Any interest in random-opponent matchmaking (skip room codes, get paired with a stranger) as a later addition, or is invite-only always the intended design?

---

*Ready to hand this directly to a vibe-coding session — each section maps cleanly to a build step.*