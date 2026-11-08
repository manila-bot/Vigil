# Vigil — Law-firm ransomware command center (with live "under attack" animations)

## Direction
Dark legal case-management look (charcoal, serif headings like a legal brief, crisp sans body, coral primary action, amber risk, lime healthy) with a cyber-ops layer on top. Law-firm framing everywhere: matter numbers, court deadlines, named counsel, privileged-file badges.

## Motion and sound (the core ask)
- **Calm state (no attack):** slow-orbiting "satellite" scanner around a wireframe shield/courthouse emblem, gentle pulse lines along the firm's network, lime "All systems verified" heartbeat.
- **Attack state (Simulate attack):** red/coral sparks burst from the hit system, glitch-flash on the litigation drive card, scanner sweeps turn amber, threat banner slides in, attack lines race across the map, counters tick up.
- **Sound:** short synthesized alert ping + low alarm hum on attack, soft chime on claim/recovery (Web Audio, no files). Mute toggle in the header, off for reduced-motion users.
- A **"Reset to normal"** control so the demo can flip between calm and attack.

## Pages
1. **Sign-in** — email/password, animated wireframe shield, sample-mode label.
2. **Command Center** — threat status hero (calm/attack animation), Firm Impact Map (animated network of firm systems: Litigation drive, Email, Document management, Billing, Court e-filing), affected matters table, Simulate attack / Report incident.
3. **Incident Workspace** — above the fold: *Filing due tomorrow at 2:00 p.m. CT*, *Exhibits inaccessible*, *Data copying unknown*, **Request IT help**. System list -> investigation panel, evidence, timeline, response room (polling), tasks with Claim task. Right panel: live deadline countdown, request status, task owner.
4. **Request IT help + Nemotron** — prefilled message, status steps (Submitting -> Saved -> Analyzing -> Recommendation ready / failed), recommendation with cited evidence and "How Nemotron reached this" tool-call list. Labeled as sample.
5. **Incidents list** and admin-only **Access** (users; responder shown as "Team Member").
6. Attack Replay scrubber + small charts (activity over time, task status, availability vs copying matrix).

## Data
Sample mode by default with clearly labeled fictional data and a fixed scenario clock. One typed API client with a live-mode switch (`VITE_USE_MOCKS=0`, base `/api`) so it can plug into your FastAPI backend later; unverified endpoints will be listed at delivery.

## Technical details
- TanStack Start routes: `/login`, `/` (command center), `/incidents`, `/incidents/$id`, `/access`.
- Animations: CSS keyframes + SVG + framer-motion; spark particles on canvas. 3D map optional later (R3F lazy-loaded) with 2D fallback.
- Sound via Web Audio oscillators; respects `prefers-reduced-motion` and a persisted mute.
- Mock store in memory with polling-compatible API so two tabs can simulate the response room.
- Recharts for charts. Note: the Pinterest link couldn't be opened, so styling follows the brief's description.
