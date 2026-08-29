# Makari Gad — Full Codebase Review

**Scope:** every JS module, HTML page, CSS file, the service worker, the SQL schema, and config, in `makarigad.github.io`.
**Goal:** feedback for changes — bugs, security, correctness, data-integrity, maintainability. No code was modified.
**Method:** the security-critical shared layer (`core-app.js`, `sw.js`, `index.js`, components, SQL, `signin.html`) was read line-by-line; the large feature pages were reviewed in parallel and the headline criticals re-verified by hand (marked ✅ below).

Legend: ✅ = I confirmed it against the source this session · 🔎 = reported during review, verify before acting · sev = **CRIT / HIGH / MED / LOW**

---

## 1. Executive summary

The app is a well-organized static PWA with genuinely good instincts: offline sync queue, service worker, one shared core module, a consistent toast/confirm UI, and a real Nepali-calendar model. The problems are **not** architectural taste — they cluster into a handful of systemic patterns that repeat on almost every page:

1. **Authorization is client-side only, on top of fully-permissive RLS** — the single most serious issue. Any authenticated user can read/write/delete any table, and can escalate their own role.
2. **Stored XSS everywhere** — DB free-text is written into `innerHTML` unescaped on every page.
3. **Silent data errors** — `x || default` eats legitimate `0`; unbounded `select('*')` silently truncates at 1000 rows; DB errors are swallowed then a success toast is shown.
4. **Duplicated business math that has already drifted** — PPA revenue, delta/cycle math, and point-in-polygon exist in 2–3 copies that disagree.
5. **A scatter of concrete broken features** — a handful of undefined refs / missing imports / wrong element IDs that throw at runtime.

Fixing the ~15 cross-cutting items in §2 resolves the majority of the individual findings at once. The verified show-stoppers are in §3.

---

## 2. Cross-cutting themes (fix once, benefits everywhere)

### A. Client-side-only authorization over permissive RLS — **CRIT**
Every RLS policy reviewed is `USING(true) WITH CHECK(true)` (see `supabase/inventory-v2-schema.sql:159-169`; the same pattern governs the other tables). All role enforcement is UI-only (`applyRoleBasedUI` in `core-app.js`, per-page `sessionData.role` checks). Consequences, all reachable with the public anon key + any login:
- **Privilege escalation:** the profile save upserts `role: window.userRole` into `user_roles` (`index.js:209-220`); user-management writes roles the same way. A user can PATCH their own row to `admin`.
- **Forgeable geofence:** attendance writes `is_valid` / lat-lng from the client (`attendance.js`), so presence can be faked.
- **Unguarded destructive ops:** "wipe all fuel", bulk deletes, expense purges are gated only by a hidden button.
- **"Read-only" roles are cosmetic** (management/staff) — the data is still writable via REST.

**Fix:** write real RLS policies keyed off a server-trusted role (JWT claim or a `user_roles` lookup inside the policy), make `user_roles` non-self-writable (admin-only via a `SECURITY DEFINER` RPC or service-role Edge Function), and treat the UI gating as convenience only. This is the one item worth doing before anything else.

### B. Stored XSS: DB text → `innerHTML` unescaped — **HIGH**
Free-text fields (remarks, names, item descriptions, photo URLs, narrative inputs) are interpolated into `innerHTML`/template strings without escaping on **every** page: `inventory.js` & `inventory.html` (item detail, ledger, and a `photo_url` written into an attribute — attribute-breakout XSS), `plant-data.js`, `operator-daily.js`, `attendance.js`, `hourly-log.js`, `energy-summary.html` (`adjustment_remarks`), `monthly_report.html`, `quarterly_report.html`, `ad-prediction.html`.
**Fix:** one `escapeHtml()` helper in `core-app.js`; route every DB string through it. For attribute contexts (`src="${photo_url}"`) escape quotes/`<`/`>` specifically or set via `.setAttribute`/`.textContent`. Given permissive RLS (theme A), any user can plant a payload another user's browser executes.

### C. Unbounded `select('*')` silently truncated at 1000 rows — **HIGH**
PostgREST caps unbounded selects at 1000. Confirmed unbounded reads that will silently lose data as history grows: `core-app.js:124` (`loadCalendarMappings` — once >1000 mapping rows exist, later dates stop resolving), `ad-prediction.html:790` (historical training data), `energy-summary.html` pagination loop, `quarterly_report.html` year fetch, various report ranges.
**Fix:** page explicitly with `.range()` until a short page returns, or push aggregation server-side (RPC/view). Never rely on the implicit cap.

### D. `x || default` / `x || null` coerces legitimate `0` — **HIGH**
A real reading of `0` (zero rainfall, zero stock, zero export) is falsy and gets replaced. Confirmed: `plant-data.js:746` (`parseFloat(...)||null` turns a genuine 0 into null), `inventory.js:353` (`min_stock || 20` — an intentional min of 0 becomes 20), rainfall "has content" checks, several hourly-log guards.
**Fix:** use `Number.isFinite(v) ? v : default` / explicit `== null` checks, not `||`.

### E. UTC off-by-one from local `Date` + `toISOString()` — **MED**
`new Date(localString).toISOString()` shifts the date backward for Kathmandu (UTC+5:45) before ~05:45 local. Confirmed: `core-app.js:141` (`getNepDateObj`), `plant-data.js:99`, `rainfall.js:69`. The **correct** pattern already exists in `nepali-calendar.js` (uses `Date.UTC(...)`).
**Fix:** standardize on the `nepali-calendar.js` approach (build from explicit Y/M/D components); export one helper and reuse.

### F. Non-atomic multi-write & swallowed errors → false success — **HIGH**
Paired writes have no transaction/rollback and many single writes never check `{ error }` before showing a success toast. Confirmed patterns: inventory transfers/edits (two writes, no rollback — a mid-failure leaves stores unbalanced), `plant-data.js` deletes unchecked, `operator-daily.js` unchecked, `energy-summary.html` pagination swallows page errors (partial totals shown as complete), `nepali-calendar.js` `saveMonth` ignores the second error.
**Fix:** always destructure and check `{ error }`; for paired writes use an RPC / Postgres function so it's atomic; only toast success when `error == null`.

### G. Duplicated business logic that has already drifted — **HIGH**
The same math is reimplemented per page and the copies disagree:
- **PPA / revenue** differs between `monthly_report.html` and `quarterly_report.html` (wet/dry season boundary and rate handling disagree → ~75% revenue divergence for the same period). At most one is correct.
- **Delta / billing-cycle math** (`getDelta`, `computeCycleData`) is copied across `index.js:359-475`, `hourly-log.js`, and the reports.
- **Point-in-polygon / distance** exists in both `core-app.js` and `attendance.js` and has **already diverged into a bug**.
- `escapeHtml` / date parsing are re-hand-rolled in `inventory.html` vs `inventory.js`.
**Fix:** lift one authoritative copy of each into `core-app.js` (or a `shared/` module) and delete the rest. Decide which PPA formula is correct with the finance owner.

### H. Chart.js instances leak on re-render — **MED**
Charts are recreated without `.destroy()`, leaking canvases/listeners and causing tooltip ghosting: `rainfall.js:532+` (5 charts), `energy-summary.html`, `ad-prediction.html`, `quarterly_report.html`.
**Fix:** keep the instance, `chart?.destroy()` before `new Chart(...)`.

### I. Hardcoded lookup tables that go stale/wrong — **MED**
Month-length tables and BS↔AD offsets are hardcoded instead of derived from `calendar_mappings`: `rainfall.js` `MONTH_DAYS`, `ad-prediction.html` BS boundary table, `energy-summary.html` (`+57`/`+56` year offset and `D1..D31` fixed 31-slot loop — truncates/overruns real month lengths), `hourly-log.js` `[2081,1,1]` fallback.
**Fix:** derive month length and AD offset from `calendar_mappings`, which is the app's source of truth.

### J. Swallowed DB errors → see F. (kept separate in per-file notes)

### K. Accessibility — **LOW-MED (broad)**
Consistent across pages: modals lack `role="dialog"`/focus-trap/Esc-to-close, form inputs not associated with `<label for>`, tab widgets not keyboard-operable, chart `<canvas>` has no text alternative, status shown by color alone.
**Fix:** a shared modal helper (focus trap + Esc + `aria-modal`), label association pass, `role="tablist"` + arrow-key handling, `aria-label`/summary table for charts.

### L. Native `alert()`/`confirm()`/`prompt()` vs the app's toast/confirm — **LOW**
The app has `showNotification`/`showConfirmation` but several places still use blocking natives (`inventory.js`, `hourly-log.js`, parts of `energy-summary.html`). Inconsistent UX and un-styled.
**Fix:** route through the shared helpers.

### M. Performance: full-table reloads, no debounce — **MED**
Search/filter re-query or re-render the whole table per keystroke, and writes trigger full reloads: `inventory.js`, `plant-data.js`, `energy-summary.html`, `quarterly_report.html` (~100 sequential round-trips to build a year).
**Fix:** debounce inputs (~250 ms), filter client-side where the set is already loaded, update rows in place after a write, batch/parallelize report fetches.

### N. `safeUpsert` retries permanent failures forever — **MED**
`core-app.js:505` queues failures to `localStorage` and re-tries on every cycle; a row that fails a constraint (a "poison" payload) is retried indefinitely and blocks the queue.
**Fix:** cap attempts, drop/park poison entries to a dead-letter list, surface a one-time error.

### O. Service worker & injected fragments — **MED/LOW**
- `sw.js:77-88` caches Supabase `/auth/` and `/rest/v1/` GET responses. Caching auth/data GETs risks serving another session's cached data and stale reads. Scope this tightly or skip auth entirely.
- `components/header.html` and `components/footer.html` contain `<script>` blocks that **never run**, because `core-app.js` injects the fragment via `el.innerHTML` (`:330`) and `innerHTML`-inserted scripts don't execute. Net effects: the **footer copyright year is blank** on every page, and the header's SW-registration script is dead (registration only happens because `index.js` also does it). ✅ verified.
- `sw.js:46` `cache.addAll` is atomic — one 404 in the 34-path precache list fails the whole install. (All 34 paths currently resolve. ✅)
**Fix:** move the fragment scripts into real modules (or run them after injection); don't cache auth; consider `Promise.allSettled` per-asset precache.

---

## 3. Critical findings (verified show-stoppers)

1. **✅ `energy-summary.html` — `safeUpsert` is never imported.** Line 597 imports only `{ supabase, initializeApplication }`, but line 1870 calls `await safeUpsert('contract_energy', data)`. Every contract-energy save throws `ReferenceError: safeUpsert is not defined`. **Fix:** add `safeUpsert` to the import. (Contrast: `monthly_report.html:556` *does* import it — see §5.)

2. **✅ `energy-summary.html:1216` — monthly-report render crashes on a missing element.** `document.getElementById('doc-hse-text').innerText = …` — but no element has `id="doc-hse-text"` (0 occurrences; sibling IDs `doc-overview-text`, `doc-highlights-list`, `inp-highlights`, `kpi-pf` all exist). The unguarded `.innerText` on `null` throws and aborts the whole preview/PDF/Word generation. **Fix:** add the element or guard the access; audit the other `doc-*`/`inp-*` IDs the same way.

3. **✅ `plant-data.js:620` — expense import purges unrelated `Mangshir` data.** The pre-insert delete is `.in('nepali_month', [p.month, p.rawMonthUploaded, 'Mangshir'])`. `'Mangshir'` is hardcoded, so importing *any* month's expense sheet also deletes every `Mangshir` expense row for that year. Silent data loss. **Fix:** remove the literal; delete only the month(s) actually being uploaded.

4. **✅ `hourly-log.js:1033-1042` — contradictory role gating.** `role === 'staff'` is locked read-only (form disabled, submit/delete hidden, banner shown), but `management` is **not** included in that lockdown, and line 1042 then re-reveals `.admin-only` controls to `staff`/`management`. The banner even claims "Management Staff cannot edit" while `management` is never actually restricted. Whether delete is exposed depends on each control's classes, but the gating is provably inconsistent. **Fix:** define one role→capability map and drive both the lock and the reveal from it; include `management` explicitly.

5. **🔎 `energy-summary.html` PPA / units.** (a) Monthly vs quarterly PPA disagree on the wet/dry boundary → large revenue divergence (theme G) — at most one is right. (b) **RESOLVED — not a bug.** The gross-gen vs station-service scaling asymmetry is *correct*: `hourly-log.js:744` stores `unit1_gen` in MWh (`GWh × 1000`) and `:748` stores `station_trans` in kWh; `plant-data.html` input labels match (MWh / kWh); energy-summary correctly uses gen unscaled and divides station by 1000. No change made. (c) 🔎 a low-discharge branch reported as dead code (still worth a look).

6. **🔎 `inventory.js` / `inventory.html` — data-integrity + XSS cluster.** Reported: a `NaN` quantity (from `parseFloat` on empty input) flows into a log and the stock trigger, corrupting `current_stock`; store-to-store transfers are two non-atomic writes with no rollback; `photo_url` interpolated into an attribute enables breakout XSS; ledger/detail render DB text unescaped. **Fix:** validate quantity (`Number.isFinite && > 0`) before write; make transfer an atomic RPC; escape all rendered text; escape/`setAttribute` for `photo_url`.

7. **🔎 `quarterly_report.html` — undefined values shown as real numbers.** `fin.gross`, `yoy`, `losses.totalExt`, `losses.plant` are referenced but never defined, rendering as `undefined`/`0` and presented as legitimate financials in an official report. **Fix:** define/derive them or remove the fields; add a "no data" state rather than silent zeros.

8. **🔎 `attendance.js` / `user-management.js:128` — sign-up hijacks the admin session.** Creating a user via `auth.signUp` on the client swaps the current session to the new user (admin gets logged out / becomes the new user). Combined with client-written `is_valid` (theme A) attendance is also forgeable. **Fix:** create users via a service-role Edge Function / admin API, not client `signUp`.

9. **✅ (theme A instance) `index.js:209-220` — self-service privilege escalation.** Profile save upserts `role: window.userRole` into `user_roles` under permissive RLS. **Fix:** never let the client write its own role (see theme A).

---

## 4. High findings (by area)

**core-app.js**
- `:124` unbounded `loadCalendarMappings` (theme C) — the whole app's date resolution silently breaks past 1000 mapping rows. ✅
- `:470-481` `applyRoleBasedUI` hides controls by injecting a `<style>` block matching `button[onclick*="save"]`/`[id*="add"]` — fragile (string-matching attributes), cosmetic only (theme A), and injects a fresh `<style>` on every call (leak). ✅
- `:505` `safeUpsert` retries poison payloads forever (theme N). ✅
- `:141` `getNepDateObj` UTC off-by-one (theme E). ✅

**index.js**
- `:4` `window.userRole = 'normal'` contradicts core's default `'operator'` — role string drift. ✅
- Duplicated delta/cycle math `:359-475` (theme G). ✅

**plant-data.js** — swallowed delete errors then success toast (theme F); XSS in rendered items (theme B); `getCurrentNepaliDate` referenced but not defined (`:425`, reported) — runtime throw; SCADA pagination reported dead; "Save JPG" targets a wrong element id.

**hourly-log.js** — beyond #4: `deleteAllLogsForDay` referenced from `hourly-log.html:50` but reported undefined (throws on click); PDF export reported blank on 3 of 4 sections; entered remarks discarded on save; `contract_energy` drift vs energy-summary.

**energy-summary.html** — pagination swallows page errors → partial data reported as full (theme F/C); duplicate event listeners accumulate on re-open (theme H-adjacent).

**rainfall.js** — Chart leaks (theme H); `MONTH_DAYS` hardcoded (theme I); `getFallbackEngDate` UTC bug (theme E); compare-year selection reported non-functional; `0`-rainfall treated as "no content" (theme D).

**ad-prediction.html** — `:790` unbounded training-data read (theme C); BS boundary table hardcoded (theme I); live-extrapolation path reported dead; chart leak.

**inventory** — native `confirm/alert` for destructive ops (theme L); full-table reload per write and per keystroke (theme M); `min_stock || 20` (theme D).

---

## 5. Verified NON-issues (dismiss these)

- **`inventory.html:653` "`initHeaderUI` may not be exported"** — false alarm. `core-app.js:349` exports `initHeaderUI`. ✅
- **`monthly_report.html:556` "`safeUpsert` may not be exported"** — false alarm. It is exported (`core-app.js:505`) **and** `monthly_report.html:556` imports it. ✅ (Do not confuse with Critical #1: `energy-summary.html` genuinely fails to import it.)
- **`sw.js` precache 404 risk** — all 34 precache paths currently resolve. ✅ (The atomic-`addAll` fragility in theme O still stands as a robustness note.)
- **`signin.html`** — reviewed, clean. Its inline `<script type="module">` runs correctly (it's real page markup, not an injected fragment), the copyright year is set, and the login flow handles offline + errors well. Minor polish only (password field not cleared on failed attempt).

---

## 6. Medium / Low & polish (grouped)

- **A11y pass** across all pages (theme K).
- **Native dialogs → shared toasts** (theme L).
- **Debounce + in-place updates** (theme M).
- **Chart `.destroy()`** (theme H).
- **Footer year / dead fragment scripts** (theme O) — visible bug (blank year) with a trivial fix.
- **`offline-sync.js`** — dead module: never imported, and gated on `window.supabaseClient` which is never set. Either wire it up or delete it to avoid confusion.
- **Date/format helpers** consolidated (themes E, G).
- **Config:** anon key in `core-app.js` is public-by-design (fine for Supabase anon), but its power today comes entirely from permissive RLS — theme A is what makes it dangerous, not the key's presence.

---

## 7. Suggested fix roadmap

**Phase 0 — stop the bleeding (small, high-impact):**
1. `energy-summary.html` import `safeUpsert` (#1) and add `doc-hse-text` / guard (#2).
2. `plant-data.js` remove the hardcoded `'Mangshir'` purge (#3).
3. Fix the `hourly-log.js` role gate (#4).
4. Footer-year / fragment-script fix (theme O).

**Phase 1 — security (do before more features):**
5. Real RLS + non-self-writable `user_roles` + server-side user creation (themes A, #8, #9).
6. `escapeHtml` helper and apply site-wide, incl. attribute contexts (theme B).

**Phase 2 — correctness/data-integrity:**
7. Kill `x || default` on numerics (theme D); check `{ error }` + atomic paired writes (theme F); bound all selects (theme C).
8. Reconcile PPA/units, consolidate duplicated math (themes G, #5, #7).

**Phase 3 — robustness & polish:**
9. Chart destroy, debounce/perf, a11y, native-dialog cleanup, `safeUpsert` poison handling, SW auth-cache scoping, remove dead code.

---

*Line numbers marked ✅ were confirmed against the source this session; 🔎 items were surfaced during the page reviews and are worth a 30-second confirm before you touch them. I can start on Phase 0 (four small, verified fixes) whenever you want — no code has been changed yet.*
