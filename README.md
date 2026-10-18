# Deadline Forge

**Difficult, reproducible software practice for the road to ICTskills nationals.**

Generate a realistic brief, download its fixtures and executable checks, work against the clock, and review your evidence. React/TypeScript frontend, Node API and real SQLite session storage. No account, AI API or subscription.

> Independent, unofficial training. Not affiliated with ICT-Berufsbildung Schweiz, ICTskills or SwissSkills. The published national Skill 09 overview specifies **Java or .NET**. This app uses a React/TypeScript/Node/SQLite practice stack and encourages translating solutions to the national stack. No generated task is an official paper or a prediction of 2027.

## Quick start

Requires **Node.js 24+** and npm. From a clone or source download:

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:3001**. Keep the terminal running; Ctrl+C stops it. A packaged release includes `dist/`, so after `npm ci` you can go straight to `npm start`.

For development, run `npm run dev` and open **http://127.0.0.1:5173**. The development API uses port 3001. Production `PORT` is configurable; the development proxy expects the default. The app works offline after installation; external source links need internet access. Fonts are bundled locally.

## Start with Nationals

The default is **Nationals**, **420 minutes**, **exam mode**. It is a connected laboratory with a suggested module budget, rather than a basic CRUD task stretched over seven hours. You can choose another time limit; the brief does not become easier when the clock is shorter.

The Nationals contract combines:

- Shared temporal capacity across competing teams. Solve peak concurrent demand correctly, including half-open intervals and a reservation spanning adjacent existing reservations.
- Atomic, persistent idempotency with team-scoped keys, semantic request fingerprints, simultaneous retries and replay after restart.
- Authoritative team ownership, isolated reads, revision-based cancellation and explicit stale-write recovery.
- A versioned **DFX1** legacy format with semicolon CSV, quoted delimiters/newlines, Unicode, BOM/CRLF normalisation, a row count and SHA-256 checksum.
- All-or-nothing imports, dry runs, reconciliation reports and exactly-once audit events.
- Evidence for race conditions, rejected operations leaving no partial state, clean-machine delivery and cross-process SQLite contention.

Six focuses change what you actually build:

| Focus | Nationals exercise |
| --- | --- |
| Full stack | Implement the complete API, persistence and a conflict-safe React UI |
| Backend/API | Implement the contract and durable transactional service; no frontend required |
| Frontend | Use the supplied correct SQLite-backed mock; build the connected views, retries, stale-response protection and browser evidence |
| SQLite | Solve six reports against 24 resources and 288 imperfect legacy allocations; then remediate violations and prove migration/rollback safety |
| Debugging | Repair an existing service with five independent faults across interval ordering, access control, retries, transaction rollback and checksum validation |
| Testing | Write service-level tests that pass a correct baseline and kill **eight realistic mutants** |

The advanced SQL work includes window functions, dense ranking with empty-team ties, peak demand, capacity violations, maximal idle intervals and deterministic latest-per-team selection. The public API suite has **25 adversarial subtests**, including two competing requests, a ten-request retry burst, semantic replay, DST offsets and a failing second import row. This is a lower bound: it does not prove every concurrency, restart or UI property.

**The trainer generates tasks and records progress. It does not execute or automatically grade your submitted code.** Run the downloaded helpers against your own solution and self-assess the rubric using evidence. Frontend HTTP checks validate the supplied mock, not your UI.

## Practice workflow

1. Pick a focus, difficulty, scenario and time limit. A blank seed generates a new one; the same seed **and settings**, within the same generator version, reproduce the brief.
2. Read the brief and criteria. Download the kit and open `START-HERE.md`. For Nationals, `CONTRACT.md` is part of the assignment.
3. Build the solution in a separate folder in your own editor. Java/.NET is encouraged when rehearsing the published national environment.
4. Start exam mode (no pauses) or practice mode (pauses allowed). A running clock continues while the browser is closed. Only one session can be active.
5. Run the tests, check evidence, finish and save a reflection. The score is self-assessed and unofficial.

Foundation, Competition and Stretch remain available for focused drills: booking, stock movements, repair ticket state transitions and workshop registrations. They include API checks, frontend mocks, SQL exercises and pure-function debug/mutation kits. Seeds vary scenarios, clients, fixture parameters and extensions. Nationals uses a shared resource-allocation contract across those contexts; it is not an unlimited AI task bank.

All kit helpers need only Node.js 24+, without npm packages. Suites make destructive fixture writes: use a **fresh, disposable solution database for every run**. Debug and incomplete SQL starters should fail until solved; testing starters deliberately miss mutants. Fake `practice-*` tokens are public fixture identities, never production authentication.

## Competition research

Public guidance checked **18 October 2026**:

- [ICT-Berufsbildung Schweiz — competition overview](https://www.ict-berufsbildung.ch/grundbildung/berufsmeisterschaft/): Skill 09 regionals are three-hour English desktop/database tasks. The national overview lists seven hours, connected frontend/API/database/data-processing/interface/speed tasks and Java or .NET; aids/equipment details remain pending.
- [Linked Skill 09 participant guidance](https://skills-for-ict-professions.jimdosite.com/skill-09/): emphasises a working application on the supplied evaluation VM and reproducible delivery. Its detailed national sections still say information will follow.
- [Regional organiser, Zentralschweiz 2026](https://www.ict-bz.ch/event/rm-ict-2026): confirms three hours, English and qualification through regional results.

A complete 2027 brief, marking scheme and final environment were **not verified**. The linked OneDrive task archives were inaccessible to the research tools. No official task text, restricted VM or competition assets are bundled. Follow your organiser’s final instructions.

## Storage and privacy

Session snapshots, timer state, checklists and reflections live in `data/practice.sqlite`. The app binds to `127.0.0.1` and has no authentication or cloud sync; it is intended as a **single-user local app**. Do not expose this server publicly as a multi-user service.

`DATABASE_PATH` selects another SQLite file. Stop the server before copying the database for a backup. To reset your history, stop the server and remove that database and any companion `-wal`/`-shm` files. Keep your solution folders separate. The log displays/exports the most recent 200 sessions. JSON export is not an import/restore feature. Existing session kit downloads use their saved snapshot, so new generator versions do not silently replace an old brief.

## Validation

```sh
npm test
npm run build
```

Tests cover all **96** scenario/focus/difficulty combinations, seeded SQLite integrity, deterministic generation, timer expiry/pause/resume, storage across reopening, API validation, ZIP snapshot exports, lower-tier helpers, every Nationals mock, broken debug exercises, all eight mutations, six independently solved SQL reports, restart replay and two independent processes contending for the same SQLite database.

GitHub Actions runs checks on Node.js 24 and 25. A release ZIP includes sources, locked dependencies and a built frontend; `node_modules`, private session databases and development scratch files are excluded.

## Other projects you could build

The app’s **Build next** page includes:

- **DeskState — Mac:** restore project folders, links and approved launch commands. A useful native daily tool.
- **Proofpack — website:** turn screenshots, test results and commit links into a verifiable portfolio/coursework evidence pack.
- **BugLens — Mac + iPhone:** capture a bug, reproduction steps and device details, then export a clean report.
- **ExplainBack — iPhone:** record short code/architecture explanations, self-review against a rubric and retry weak topics.
- **Borrowed — iPhone:** track lent items with a photo, borrower and return reminder.

Start with DeskState for a native product or Proofpack for a web product that also improves your own project presentation.

## Hosting

GitHub contains the complete runnable app and release downloads. A static Pages upload alone cannot run its Node/SQLite API. Cloudflare hosting would need a Workers/D1 adapter or a separately hosted API, plus authenticated deployment access; this release does not pretend a static frontend is the complete app.
