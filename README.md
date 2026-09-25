# Belanja

**Belanja** is a personal monthly expense management web application. Track **fixed expenses** (recurring bills), **variable expenses** (one-off daily spending), and **installments / loans**, then **open and close each calendar month**. Closing a month captures a historical **snapshot**, so a closed month always tells the truth about what was actually spent that month — even if you edit or delete a recurring expense or loan afterwards.

- **Stack:** Node.js (Express) + PostgreSQL, plain HTML/CSS/JS
- **No TypeScript, no front-end framework, no ORM** — vanilla JS plus `pg` with parameterized SQL only
- **Currency:** RM (MYR)
- **Default URL:** http://127.0.0.1:3000 — open it and register an account
- **Native Android (Termux):** runs without Docker — see [Termux Installation](#termux-installation)

---

## Termux Installation

Belanja runs natively on Android inside **Termux** — no Docker, no root, no systemd, no nginx. The backend serves the static frontend *and* the `/api` on one port, backed by a native PostgreSQL instance. Average install time ≈ 1–2 minutes on a phone.

### Requirements

- **Termux** from F-Droid (the Play Store build is stale). Download at https://f-droid.org/packages/com.termux/
- `pkg update` must work (internet access).
- Ports `3000` and `5432` free inside Termux.

### Install (one command)

```bash
termux-setup-storage          # optional but recommended (backups)
git clone <your-repo-url> belanja-termux
cd belanja-termux
./scripts/setup-termux.sh
```

What the script does, automatically and idempotently:

1. Installs `git`, `nodejs` and `postgresql` via `pkg` (skips already-installed packages).
2. Creates `app/.env` from `app/.env.example` with a **random** `JWT_SECRET` and `POSTGRES_PASSWORD`.
3. Initializes the Postgres data directory (`initdb`, UTF-8, `--locale=C`) on first run.
4. Starts Postgres and creates the `belanja` role + `belanja` database (idempotent).
5. Installs npm dependencies and runs the DB migrations.

### Start / Stop

```bash
./scripts/start-termux.sh    # starts Postgres + the app in the foreground
```

Open **http://127.0.0.1:3000** and register an account. Press `Ctrl+C` to stop the app; the script stops cleanly and removes its PID file.

```bash
./scripts/stop-termux.sh              # stops the Belanja app only (via PID file)
./scripts/stop-termux.sh --postgres   # stops Belanja + the Postgres server
```

> Process management is **PID-file based** (see `scripts/lib-app.sh`). `stop-termux.sh`
> stops exactly the Belanja node process recorded at start — it never runs
> `pkill node`/`killall node`, and PostgreSQL is left running unless you pass
> `--postgres`. Starting while the app is already running is refused (no
> duplicate node processes).

Useful operators (all idempotent / safe to re-run):

| Task | Command |
| ---- | ------- |
| Update the app | `git -C <repo> pull && ./scripts/setup-termux.sh` |
| Re-run migrations | `cd app && npm run db:migrate` |
| Migration status | `cd app && npm run db:status` |
| Request logs (verbose) | `LOG_REQUESTS=true ./scripts/start-termux.sh` |
| Postgres status | `pg_ctl -D $PREFIX/var/lib/postgresql status` |
| Backup (SQL dump) | `pg_dump -U belanja belanja -f belanja-backup.sql` |
| Restore (fresh DB) | `psql -U belanja -d belanja -f belanja-backup.sql` |

### Expose the app publicly (Cloudflare Tunnel, optional)

A native Termux `cloudflared` connector exposes the app over a public HTTPS URL
without opening any inbound ports. Configure it once, then start it with the app:

```bash
# 1. On the Cloudflare Zero Trust dashboard: Networks -> Tunnels -> Create a
#    tunnel; add a Public Hostname -> service HTTP ->  http://127.0.0.1:3000.
./scripts/setup-cloudflare.sh        # paste the tunnel token here (stored
                                     #  chmod 600 in .config/cloudflared.env)
./scripts/start-termux.sh --cloudflare   # app + tunnel
# or, everything in one go:
./scripts/start-all-termux.sh        # PG -> app -> tunnel (if token exists)
```

The token is only ever stored in `.config/cloudflared.env` (`chmod 600`,
git-ignored) and is never printed, logged or committed. Stop the tunnel with
`./scripts/stop-cloudflare.sh`.

### How the pieces fit together

- **`scripts/lib-postgres.sh`** — shared POSIX-sh helpers (`pg_start`, `pg_stop`, `pg_ensure_role`, `pg_ensure_db`) used by all the scripts. Data lives in `$PREFIX/var/lib/postgresql`, the socket in `$PREFIX/tmp`, logs in `$PREFIX/var/log/belanja-postgresql.log`.
- **`scripts/lib-app.sh`** — PID-file helpers for the app's own processes (backend + cloudflared) under `runtime/` so stop helpers are surgical.
- **`scripts/setup-termux.sh`** — one-shot provisioning. Safe to re-run after a `git pull`.
- **`scripts/start-termux.sh`** — starts Postgres (if not already running), waits for readiness, runs migrations, then starts the backend in the foreground with `HOST=127.0.0.1` and `PORT=3000` from `.env`; loads `--cloudflare` when asked, tears the tunnel down with the app on exit.
- **`scripts/start-all-termux.sh`** — starts Postgres → applies migrations → starts the app → starts the tunnel if a token is configured.
- **Backend static hosting** — `backend/server.js` serves `../frontend` directly with cache headers (`service-worker.js` → `no-store`, static assets → `public, max-age=3600`) and an SPA fallback for non-`/api` GET routes, replacing what nginx used to do in the Docker setup.

> **Docker removed.** This repo no longer ships `Dockerfile`, `docker-compose.yml`, `nginx/` or `.dockerignore` — the Termux-native setup is the only supported run mode. The Docker documentation sections below (Architecture, Docker Architecture, Installation, Start/Stop, Cloudflare Tunnel) describe the previous Docker layout and are kept for historical reference only.

---

## Features

- **User accounts** — register, login, logout; each user's data is fully isolated.
- **Fixed expenses** — recurring masters (rent, insurance, subscriptions…). Create, edit, pause/resume, delete.
- **Variable expenses** — one-off transactions (food, fuel, toll…). Categorised, dated, attached to a month.
- **Installments / loans** — track monthly installment, total/paid months, auto-computed remaining months and balance.
- **Monthly system** — one record per `(user, year, month)`; explicit **Open / Close / Reopen** lifecycle, no auto-open.
- **Historical snapshots** — closing a month freezes the recurring amounts for that month.
- **Read-only closed months** — variable expenses in a closed month cannot be added, edited or deleted; closed months can be explicitly **reopened** for corrections (current + previous 3 months).
- **Dashboard** — current-month totals, 12-month expense chart, active installment progress.
- **Mobile + PWA** — responsive layout with a mobile bottom navigation, comfortable touch targets, an installable web app (`manifest.json`), and a service worker that caches the static shell (never API/auth/user data) with an offline fallback page.
- **Security** — bcrypt password hashing, httpOnly JWT cookies, rate limiting, CORS, security headers.
- **Dockerized** — one-command startup; optional Cloudflare Tunnel for public HTTPS access.

---

## Technology Stack

| Component            | Technology                                          |
| -------------------- | --------------------------------------------------- |
| Frontend             | HTML, CSS, vanilla JavaScript (no framework)        |
| Backend              | Node.js ≥ 20, Express **4.21.2**                    |
| Database             | PostgreSQL **15** (`postgres:15-alpine`)            |
| Database driver      | `pg` **8.13.1** (parameterized queries only)        |
| Authentication       | JWT (`jsonwebtoken` **9.0.2**) + `bcryptjs` **2.4.3** |
| Session storage      | Signed JWT in an httpOnly cookie                    |
| Validation           | Hand-rolled validation middleware (`middleware/validate.js`) |
| Security headers     | `helmet` **8.0.0**                                  |
| Rate limiting        | `express-rate-limit` **7.4.1**                      |
| Cookies              | `cookie-parser` **1.4.7**                           |
| Environment          | `dotenv` **16.4.7**                                 |
| Reverse proxy / web  | Nginx **1.27** (`nginx:1.27-alpine`)                |
| Containerization     | Docker + Docker Compose (Compose v2)                |
| External access      | Cloudflare Tunnel (`cloudflare/cloudflared:latest`, optional profile) |
| Public image bases   | `node:20-alpine` (backend), `postgres:15-alpine` (db) |

> Versions above are read from `backend/package.json`, `Dockerfile` and `docker-compose.yml`.

---

## Architecture

```mermaid
flowchart TD
    subgraph Internet
        User[User / Browser]
    end

    subgraph "Docker Compose project: belanja"
        Nginx["nginx:1.27-alpine<br/>port 8080:80"]

        subgraph "frontend (static)"
            HTML[HTML / CSS / JS pages]
        end

        Backend["backend:4000<br/>Node.js + Express"]

        DB[("db:5432<br/>postgres:15<br/>volume: belanja_pg_data")]

        Nginx -->|serves /| HTML
        Nginx -->|proxies /api/*| Backend
        Backend -->|SQL over TCP 5432| DB
    end

    CloudflareTunnel["cloudflared<br/>(optional profile: tunnel)"]

    User --> Nginx
    CloudflareTunnel -.->|public HTTPS with token config| Nginx

    style CloudflareTunnel stroke-dasharray: 5 5
```

### Components

- **Nginx** (`nginx:1.27-alpine`, exposed on host port `8080`) — the only entry point into the application. It serves the static frontend from `./frontend` and reverse-proxies every `/api/*` request to the backend container on port `4000`. It forwards the real client IP and the original `Host`/scheme using `X-Forwarded-*` headers.
- **Backend** (`belanja-backend` image, built from `app/`) — Express API on port `4000` *inside* the compose network (no host port). Applies DB migrations at startup, then serves JSON. Runs as the non-root `node` user.
- **Database** (`postgres:15-alpine`) — listens on `5432` inside the network, published **host-only** on `127.0.0.1:5433` (5432 was already taken on this host by an unrelated project). Persistent data lives in the named volume `belanja_pg_data`.
- **Cloudflared** (optional) — an opt-in compose profile (`--profile tunnel`) that connects to Cloudflare Zero Trust so the app is reachable from the public internet over HTTPS. Not required for local use.

---

## Request / Data Flow

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant B as Browser
    participant N as Nginx (:8080)
    participant A as Backend API (:4000)
    participant P as PostgreSQL (:5432)

    U->>B: Open http://localhost:8080/dashboard
    B->>N: GET /dashboard.html
    N->>B: Static HTML/CSS/JS
    B->>N: GET /api/auth/me (cookie)
    N->>A: proxied /api/auth/me
    A->>A: verify JWT (httpOnly cookie)
    A->>P: SELECT user
    P-->>A: user row
    A-->>B: JSON {status:'ok', user}
    B->>N: GET /api/dashboard
    N->>A: proxied /api/dashboard
    A->>P: monthly totals + 12-month series
    P-->>A: aggregated rows
    A-->>B: JSON totals + series + installments
    B-->>U: Renders stat cards, chart and progress bars
```

In plain terms:

1. The browser loads a static page from Nginx.
2. Every page script calls `GET /api/auth/me` to confirm the session and render the app shell.
3. Nginx forwards `/api/*` to the Express backend.
4. The backend authenticates the JWT (httpOnly cookie, with `Authorization: Bearer` fallback for API tooling).
5. The backend runs parameterized SQL against PostgreSQL.
6. PostgreSQL returns rows; the backend returns JSON (never cached).
7. The browser updates the DOM.

---

## User Registration Flow

```mermaid
flowchart TD
    A[User submits register form] --> B[Validate input<br/>name, email format, password length]
    B -->|invalid| E[400 with field errors]
    B -->|valid| C[Normalize email lowercase]
    C --> D[Hash password<br/>bcrypt, 12 rounds]
    D --> F[Insert into belanja.users]
    F -->|email already exists| G[409 An account with this email already exists]
    F -->|success| H[Sign JWT<br/>sub=user_id, exp=7d]
    H --> I[Set httpOnly cookie belanja_token<br/>SameSite=Strict]
    I --> J[201 + token + user]
    J --> K[Redirect to dashboard]
```

- Email is trimmed and lowercased before storing (and the DB enforces `email = lower(email)`).
- The password is hashed with **bcrypt (12 rounds)** — plaintext is never stored.
- A duplicate email surfaces as HTTP `409` via the unique constraint (`23505`).
- On success the server sets the session cookie directly in the response; the client receives `{ status, token, user }` and navigates to the dashboard.

---

## Login Flow

```mermaid
flowchart TD
    A[User submits login form] --> B[Validate credentials present]
    B -->|invalid| E[400]
    B -->|valid| C[Lookup user by normalized email]
    C -->|not found| F[401 Invalid email or password]
    C -->|found| D[bcrypt.compare password]
    D -->|mismatch| F
    D -->|match| G[Sign JWT sub=user_id]
    G --> H[Set httpOnly cookie]
    H --> I[200 + token + user]
    I --> J[Redirect to dashboard]
```

Authentication is handled as follows:

- The JWT payload carries only `{ sub: user_id, email }`, signed with `JWT_SECRET`, expiring after `JWT_EXPIRES_IN` (default `7d`).
- The token is delivered in an **httpOnly** cookie (`belanja_token`) with `SameSite=Strict` and `Secure` in production, so JavaScript cannot read it and cross-site requests won't carry it.
- `middleware/auth.js` reads the cookie first, falls back to `Authorization: Bearer <token>` (for curl/API tooling), verifies the signature, and sets `req.user.id` from the token — never from the client body.
- Login and register endpoints are rate limited strictly (30 / 15 min per IP) to slow brute-force attempts. The same generic `401 Invalid email or password` is returned for unknown email *and* wrong password (no user-enumeration hint).

---

## Expense Management Overview

```mermaid
flowchart LR
    subgraph Masters["Recurring definitions (live masters)"]
        FE[Fixed Expenses] --> M
        IL[Installments / Loans] --> M
    end
    VE[Variable Expenses<br/>one-off, dated] --> M
    M["Monthly record<br/>(user, year, month)"] --> D[Dashboard]
    D --> C[12-month chart]
    D --> IP[Installment progress & unpaid balance]
```

### What the four concepts mean

| Concept | What it is | Stored where | Part of monthly total |
| ------- | ---------- | ------------ | --------------------- |
| **Fixed expense** | A recurring amount expected every month (rent, insurance) | `fixed_expenses` (a *master*) | Yes — its `amount`, if `active` |
| **Variable expense** | A real one-off transaction on a specific date (lunch, fuel) | `variable_expenses` (an *actual*) | Yes — its `amount` in its dated month |
| **Installment / loan** | A loan you pay every month for a fixed number of months | `installments` (a *master*) | Yes — its `monthly_installment`, if `active` |
| **Monthly entry** | The per-month record with status `OPEN`/`CLOSED` | `monthly_entries` + snapshot tables | Aggregates the above for that month |

A month's **expected** recurring items come from the active masters while the month is `OPEN`; once **CLOSED**, those same items come from frozen snapshot rows. Variable expenses are always the real transaction rows.

---

## Fixed Expense Process

1. **Create** — on the *Fixed Expenses* page click **+ Add Fixed Expense**, choose a **type** (bank, shopee_paylater, tiktok_paylater, credit_card, bill, property, vehicle, hutang_orang, others), enter a **name** and the monthly **amount (RM)**, optionally add remarks.
2. **Save** — `POST /api/fixed-expenses` validates and inserts a row into `fixed_expenses` (active by default).
3. **Appears in monthly calculation** — for any `OPEN` month, the monthly page and dashboard list the expense and add its amount to the fixed total (active items only).
4. **Edit** — change name/type/amount/remarks via `PUT /api/fixed-expenses/:id`.
5. **Disable / enable** — `PATCH /api/fixed-expenses/:id/active` pauses the expense without deleting it; inactive items disappear from open-month totals and are not snapshotted at close time.
6. **Delete** — `DELETE /api/fixed-expenses/:id` removes the master.

### How history is preserved

Editing or deleting a fixed expense **never changes a closed month**. When a month is closed, the backend already copied the active masters into `monthly_fixed_expenses` (a snapshot). Closed months read from that snapshot; only `OPEN` months read the live master. So bumping *Rent* from RM1,500 → RM1,600 changes this month going forward but not the already-closed months.

---

## Variable Expense Process

```mermaid
flowchart TD
    A[On monthly page click + Add Expense] --> B[Enter name + category]
    B --> C[Enter amount RM]
    C --> D[Pick expense date]
    D --> E[Optional remarks]
    E --> F[Save POST /api/variable-expenses]
    F --> G{Month of expense_date CLOSED?}
    G -->|yes| H[409 read-only]
    G -->|no| I[Insert row into variable_expenses<br/>year/month derived from date]
    I --> J[Monthly total and dashboard update]
```

- The **date** decides the month: `year` and `month` are **STORED generated columns** derived from `expense_date`, so they can never disagree with the date.
- Adding / editing / deleting is refused with `409 Conflict` if that expense's month is `CLOSED` (`variableExpenseService.assertMonthOpen`).
- Categories: `food, groceries, parent, toll, fuel, others`.

---

## Installment / Loan Process

1. **Create** — on the *Installments* page click **+ Add Installment**, enter a loan/item **name** and **type**, then:
   - **Monthly installment (RM)** — what you pay each month,
   - **Total amount (RM)** — the overall loan value,
   - **Total months**, **Paid months** (default 0),
   - optional start/end dates and remarks.
2. **Save** — `POST /api/installments` stores the master. `remaining_months` is computed by the database as a **STORED generated column**: `total_months − paid_months` (it can never drift). `end_date`, if left blank, is derived as `start_date + total_months`.
3. **Appears in monthly expenses** — for `OPEN` months the `monthly_installment` of every **active** loan is listed and added to the installments total.
4. **Progress** — dashboards render `paid / total` months with a progress bar (`paid/total × 100`).
5. **Pause/resume** — `PATCH /api/installments/:id/active` toggles whether the loan counts in open-month totals.
6. **Delete** — removes the master; closed months keep their snapshot.

### Example (as verified in the end-to-end tests)

| Field | Value |
| ----- | ----- |
| Item | iPad |
| Monthly installment | RM 250.00 |
| Total months | 18 |
| Paid months | 9 |
| **Remaining months** | **9** (auto) |
| Progress | 50% |
| Remaining balance | 9 × RM 250 = **RM 2,250.00** |

---

## Monthly Expense Process

This is the heart of Belanja.

**The "current month"** is defined by the `APP_TIMEZONE` setting (default `Asia/Kuala_Lumpur`,
configurable in `.env`). Every monthly rule (which month can be opened, the editable window,
auto-close) is computed from that clock consistently, never from the device or UTC.

```mermaid
flowchart TD
    A["Month identified by (user, year, month)"] --> C{Official entry exists?}
    C -->|no + it is the CURRENT month| D[status NOT OPEN<br/>live recurring preview]
    C -->|no, past| H2[status HISTORY<br/>empty, read-only]
    C -->|no, future| F1[status FUTURE<br/>empty, read-only]

    D --> O[Frontend shows Open Month button]
    O -->|POST /open| E[status OPEN<br/>expected = live active masters<br/>editable: variable expenses allowed]

    C -->|yes| S{Entry status}
    S -->|OPEN| E
    S -->|CLOSED| G[status CLOSED<br/>expected = frozen snapshots<br/>read-only]

    E --> T[Monthly total<br/>fixed + installments + variable]
    G --> T

    T --> I{User closes month?}
    I -->|yes| J[Snapshot active fixed + installments<br/>POST /close]
    J --> K[Status -> CLOSED, closed_at stamped]

    G -.->|try to add/edit/delete<br/>variable expense| X[409 Conflict]
    G -.->|reopen within editable window<br/>POST /reopen| R[status OPEN, reopened_at stamped<br/>snapshot kept until next close]
```

### How it actually works

- **No auto-open** — `GET /api/monthly/:year/:month` is **read-only**: it never creates or flips
  an entry. A month you never opened shows as `NOT OPEN` (current month, with a preview of
  today's expected recurring costs) or `HISTORY`/`FUTURE` (no data, read-only).
- **Opening is explicit** — `POST /api/monthly/:year/:month/open` opens **only the current
  calendar month**. Opening a future month → `400`; a past month → `409` (past months can only
  be *reopened*). A `UNIQUE(user_id, year, month)` constraint keeps one row per month.
- **Recurring expenses** — while the month is `OPEN`, the *expected* fixed expenses and
  installments are read **live** from the active master tables (real WYSIWYG: edit a master and
  open months change).
- **Variable expenses** — added on the monthly page; the backend refuses any mutation once the
  target month is `CLOSED` (`409`), or happens to be a future month (`400`), or is outside the
  editable window (`409`), or has no open entry (`409`).
- **Monthly total** = `fixed` + `installments` + `variable` for that month (live masters or
  snapshot depending on status).
- **Close month** — `POST /api/monthly/:year/:month/close` runs in a single transaction:
  1. copies every **active** fixed expense (name, type, amount, remarks) into `monthly_fixed_expenses`,
  2. copies every **active** installment (loan name, type, monthly installment, remarks) into `monthly_installments`,
  3. flips the entry to `CLOSED` and stamps `closed_at`.
- **Idempotent** — closing an already-closed month is a no-op that returns the frozen data with
  `alreadyClosed: true`; reopening and closing again rebuilds the snapshot once (never duplicates).
- **Reopen** — `POST /api/monthly/:year/:month/reopen` lets you correct a closed month within
  the editable window. Reopening is required whenever a month falls behind the current one
  (including the current month), and the previous 3 calendar months are reopenable.
- **Editable window** — current month plus the previous 3 calendar months. Anything older is
  permanently read-only (`409` even for reopen).
- **Lazy auto-close** — on any authenticated request, the backend automatically closes stale
  `OPEN` months: months older than the current one that were never explicitly reopened (and any
  future-dated `OPEN` leftovers from before this rule). Explicitly reopened months stay open for
  corrections. Auto-close never opens or reopens anything.
- **Closed months are read-only** — historical recurring values come from the snapshot tables,
  and variable-expense writes are rejected until the month is explicitly reopened.

---

## Historical Snapshot

Monthly snapshots exist so that **history never lies**. Today's recurring definitions describe the *current* amount; a past month should record what was actually owed *then*.

### Concrete example

```
January  (closed)
  House Rent: RM 1,500   ← frozen into monthly_fixed_expenses at close time

Later the user edits:
  House Rent: RM 1,600   ← live master now says RM 1,600

Result:
  January  total  = still RM 1,500   (snapshot, untouched)
  February (open) = RM 1,600         (live)
```

```mermaid
flowchart LR
    FE[fixed_expenses master<br/>House Rent RM 1,600] -->|"when month is OPEN"| OPEN[Monthly entry sums live]
    FE -->|"when month is CLOSED"| SNAP[monthly_fixed_expenses<br/>snapshot RM 1,500]
    SNAP --> HIST[Closed months read snapshot<br/>(records preserved)]
```

- Snapshot rows keep the master `id` for traceability (`SET NULL` if the master is later deleted).
- The same mechanism preserves installments (`monthly_installments`).
- Variable expenses need no snapshot: they are *actual* transactions, stored once, and only gated by status.

---

## Dashboard

The Dashboard (`/dashboard.html`) is a single `GET /api/dashboard` rendered client-side:

- **Current month** — heading ("Expenses for September 2026") plus an `OPEN`/`CLOSED` status badge.
- **Five stat cards**
  - *Total Expenses* — current-month grand total,
  - *Fixed Expenses* — fixed subtotal + active count,
  - *Installments* — installment subtotal + active count,
  - *Variable Expenses* — variable subtotal + entry count,
  - *Unpaid Installments* — sum of `remaining_months × monthly_installment` across active loans.
- **Monthly chart** — the last 12 months (including the current one). Each bar shows the total per month; hover reveals fixed / installments / variable breakdown. Built entirely with CSS bars — **no chart library**. Closed months plot their frozen snapshots; only the **current** (open) month plots the live recurring totals — matching the stat cards; any other month (with an `OPEN` entry or no entry at all) plots only its own actual variable expenses, so empty months read `0` and a month never inherits another month's total. The date range label uses the Unicode en-dash (e.g. `Oct 2025 – Sep 2026`).
- **Active installments** — loan name, monthly amount, paid/total months, remaining months, progress bar, and an "Unpaid total".

```mermaid
flowchart LR
    API["GET /api/dashboard"] --> CM[Current month totals]
    API --> S[12-month series<br/>snapshot for CLOSED, live for OPEN]
    API --> I[Active installments + unpaid balance]
    CM --> Cards[5 stat cards]
    S --> Chart[CSS bar chart with hover tooltips]
    I --> List[Progress bars list]
```

> There are no screenshots committed in the repository, so none are included here.

---

## Mobile & PWA

Belanja is fully usable on phones and can be installed to the home screen. Everything is plain HTML/CSS/JS served by nginx — no rebuild needed.

### Mobile layout

- At **≤ 720px** a fixed **bottom navigation** replaces the top nav: `Dashboard | Monthly | Expenses | More` (More opens the full menu, including Fixed Expenses, Installments, Profile and Logout — the top hamburger still works).
- The layout is **width-driven** (`@media (max-width: 720px)` / `400px`), so desktop is untouched at larger sizes. Stat cards, page headers, month navigation and action buttons stack; primary actions go full-width.
- **No horizontal page scroll** at ≥ 320px: tables become labelled stacked cards (`data-label` on every `<td>`), the 12-month chart scrolls inside its own `.chart-wrap` instead of being squashed, and 2-column grids collapse to one column.
- **Touch ergonomics** — buttons are ≥ 44px tall, form inputs use `font-size: 16px` (no iOS auto-zoom), modals fit small screens, toasts float above the bottom nav, and `env(safe-area-inset-*)` offsets respect notches.

### Installable PWA

- `frontend/manifest.json` — name **Belanja**, `display: standalone`, `orientation: portrait`, theme `#0f766e`, background `#f4f6f8`, 192/512 icons plus a **maskable** variant and an `apple-touch-icon`.
- Every HTML page (auth + app) carries the manifest link, `theme-color`, `apple-mobile-web-app-*` metadata and icon links.
- `navigator.serviceWorker.register('/service-worker.js')` is wired once in `frontend/js/ui.js` (loaded by every page).

### Caching strategy

Served cache control (nginx):

| Asset | Header |
| ----- | ------ |
| `/service-worker.js` | `Cache-Control: no-store` (always fresh) |
| `/manifest.json` | `public, max-age=3600` |
| static css/js/png/gif/svg/ico/woff | `public, max-age=3600` |
| `/api/*` | `no-store` (set by the Express API) |

The service worker uses one versioned cache, `belanja-static-v2`, purged on every deploy/new version:

- **Install** — precaches the HTML shell (all 10 pages + offline.html), `style.css`, all `js/`, the manifest and icons.
- **Static requests** — cache-first, falling back to the network and caching successful responses.
- **`/api/*`** — never intercepted; **network only**, so personal expense data, the session and anything sensitive is never stored in the browser cache. No JWTs/passwords/expense rows are written to `localStorage`/IndexedDB (verified by the PWA test).
- **Navigations** — **stale-while-revalidate**: the precached shell is rendered instantly on every page turn (no waiting on a network round-trip — the main speed fix for slow Termux/`cloudflared` navigation), then revalidated from the network in the background so the next visit is fresh. Query-string variants like `/monthly.html?year=2026&month=9` are cached under a single normalized key (`/monthly.html`) so the cache stays bounded. When the network is unreachable the offline page is shown.
- Offline: the static shell still works; data views need the network (API data is purposefully not cached).
- Old `belanja-static-*` caches are removed on `activate`; `skipWaiting` + `clients.claim` make updates apply immediately.

### Offline behaviour

Only the static shell works offline: you can open the app and see the cached pages, but every data view still needs the network (API data is purposefully not cached). There is **no offline write queue** in this phase — expenses and month actions require a connection.

> PWA features (service worker, caches) require a **secure context**: `localhost` and HTTPS (e.g. the Cloudflare tunnel). The Playwright PWA suite runs against a real secure origin: the test starts a tiny reverse proxy inside the Playwright container on `127.0.0.1` (`http://localhost:<port>`, forwarded unchanged to the app) and drives Chromium against it.

---

## Database Design

Schema: `belanja`. Eight tables, every user-owned row cascades on user deletion.

```mermaid
erDiagram
    users ||--o{ fixed_expenses : "owns"
    users ||--o{ variable_expenses : "owns"
    users ||--o{ installments : "owns"
    users ||--o{ monthly_entries : "owns"
    users ||--o{ monthly_fixed_expenses : "owns"
    users ||--o{ monthly_installments : "owns"
    monthly_entries ||--o{ monthly_fixed_expenses : "snapshots"
    monthly_entries ||--o{ monthly_installments : "snapshots"
    fixed_expenses |o--o{ monthly_fixed_expenses : "referenced (SET NULL)"
    installments |o--o{ monthly_installments : "referenced (SET NULL)"

    users {
        uuid id PK
        text name
        text email UK "unique, lowercase"
        text password_hash
        timestamptz created_at
        timestamptz updated_at
    }
    fixed_expenses {
        uuid id PK
        uuid user_id FK
        text name
        text type
        numeric amount "12,2"
        text remarks
        boolean active
    }
    variable_expenses {
        uuid id PK
        uuid user_id FK
        text name
        text type
        numeric amount "12,2"
        date expense_date
        int year "generated stored"
        int month "generated stored"
    }
    installments {
        uuid id PK
        uuid user_id FK
        text loan_name
        numeric amount "12,2"
        int total_months
        int paid_months
        int remaining_months "generated stored"
        numeric monthly_installment "12,2"
        boolean active
    }
    monthly_entries {
        uuid id PK
        uuid user_id FK
        int year
        int month
        text status "OPEN | CLOSED"
        timestamptz closed_at
    }
    monthly_fixed_expenses {
        uuid id PK
        uuid monthly_entry_id FK
        uuid user_id FK
        uuid fixed_expense_id FK "SET NULL"
        text name
        text type
        numeric amount "12,2"
    }
    monthly_installments {
        uuid id PK
        uuid monthly_entry_id FK
        uuid user_id FK
        uuid installment_id FK "SET NULL"
        text loan_name
        text type
        numeric monthly_installment "12,2"
    }
    schema_migrations {
        text version PK
        text checksum
        timestamptz applied_at
    }
```

### Table reference (from `backend/db/migrations/001…006`)

| Table | Role | Key constraints |
| ----- | ---- | --------------- |
| `users` | Accounts | `UNIQUE(email)` (lowercase check), `id uuid default gen_random_uuid()` |
| `fixed_expenses` | Recurring masters | `user_id → users ON DELETE CASCADE`; partial index on active; type CHECK (9 types) |
| `variable_expenses` | One-off actuals | `year`/`month` **GENERATED STORED** from `expense_date`; type CHECK (6 types); `(user_id, year, month)` index |
| `installments` | Loan masters | `remaining_months` **GENERATED STORED** = `total_months − paid_months`; `paid_months ≤ total_months`; partial index on active |
| `monthly_entries` | Per-month records | `UNIQUE(user_id, year, month)`; `status ∈ {OPEN, CLOSED}` |
| `monthly_fixed_expenses` | Snapshot at close | `monthly_entry_id → monthly_entries CASCADE`; `fixed_expense_id → fixed_expenses SET NULL`; `UNIQUE(monthly_entry_id, fixed_expense_id)` |
| `monthly_installments` | Snapshot at close | `monthly_entry_id → monthly_entries CASCADE`; `installment_id → installments SET NULL`; `UNIQUE(monthly_entry_id, installment_id)` |
| `schema_migrations` | Migration bookkeeping | `version` PK + content `checksum` |

> Note: there is **no `monthly_variable_expenses` table**. Variable expenses are stored once in `variable_expenses`; closed months simply lock them.

---

## Docker Architecture

```mermaid
flowchart TD
    Lcompose[Docker Compose - project name: belanja]

    subgraph compose["compose services"]
        NGX[nginx<br/>host 0.0.0.0:8080 -> container 80]
        BE[backend<br/>container 4000<br/>healthcheck /api/health]
        PG[postgres:15-alpine<br/>host 127.0.0.1:5433 -> container 5432<br/>volume belanja_pg_data]
        CF[cloudflared<br/>profile: tunnel]
    end

    Lcompose --> NGX
    NGX --> BE
    BE --> PG
    CF --> NGX

    subgraph vol["Named volume"]
        V((belanja_pg_data))
    end
    PG --> V
```

| Service | Image | Container port | Published on host | Healthcheck |
| ------- | ----- | -------------- | ----------------- | ----------- |
| `db` | `postgres:15-alpine` | `5432` | `127.0.0.1:5433` (host-only) | `pg_isready -U $POSTGRES_USER -d $POSTGRES_DB` (5s interval) |
| `backend` | `belanja-backend` (built from `Dockerfile`) | `4000` | none | `node fetch('http://localhost:4000/api/health')` (10s) |
| `nginx` | `nginx:1.27-alpine` | `80` | `$APP_PORT` → `8080` | depends_on backend healthy |
| `cloudflared` | `cloudflare/cloudflared:latest` | — | none | none (opt-in `--profile tunnel`) |

- **Networks** — all services share the default compose network `belanja_default`; services address each other by service name (`backend`, `db`). `app.set('trust proxy', 1)` + forwarded headers let the backend see the real client IP for rate limiting.
- **Volume** — `pg_data` is a **named volume pinned to `belanja_pg_data`**, deliberately reusing the volume pre-created for this project so data survives `docker compose down`.
- **Startup order** — backend waits for `db` to be *healthy*, runs migrations, then passes its own healthcheck so `nginx` only starts proxying once the API is ready.
- **Build context** — the image is built from `app/` (see `Dockerfile`), runs as the non-root `node` user, and installs only production deps (`npm install --omit=dev`).

---

## Project Directory

```
Belanja/app
├── docker-compose.yml          # db + backend + nginx (+ optional cloudflared)
├── Dockerfile                  # backend image: node:20-alpine, non-root
├── package.json                # test runner scripts (`npm test`)
├── .env.example                # env template — copy to .env
├── .env                        # REAL secrets (gitignored)
├── .gitignore / .dockerignore
├── README.md
├── nginx/
│   └── nginx.conf              # static frontend + /api reverse proxy
├── backend/
│   ├── server.js               # app entry: security, CORS, rate limits, wiring
│   ├── config.js               # env-driven configuration
│   ├── package.json            # deps & scripts (db:migrate, db:status, check)
│   ├── db/
│   │   ├── pool.js             # pg Pool, search_path pinned to `belanja`
│   │   ├── migrate.js          # idempotent runner (advisory lock + checksum)
│   │   └── migrations/         # 001…006 *.sql (up + down)
│   ├── routes/                 # auth, fixedExpenses, variableExpenses,
│   │                           # installments, monthly, dashboard, health
│   ├── services/               # business logic (monthly snapshots, closed-month guard)
│   ├── middleware/             # auth (JWT), validate (body/UUID), requestLogger
│   └── utils/                  # validators, constants, http/error helpers
├── frontend/                   # served by nginx from /usr/share/nginx/html
│   ├── index.html, login.html, register.html
│   ├── dashboard.html, monthly.html
│   ├── fixed-expenses.html, variable-expenses.html
│   ├── installments.html, profile.html
│   ├── offline.html            # service-worker offline fallback
│   ├── manifest.json           # PWA web app manifest
│   ├── service-worker.js       # static-shell cache (never /api)
│   ├── images/                 # PWA icons (192, 512, maskable, apple-touch)
│   ├── css/style.css
│   └── js/                     # ui.js (API client + shell), one file per page
└── tests/                      # automated suites (run via `npm test`, see Testing)
    ├── api/
    │   ├── test-crud-8080.mjs  # CRUD + auth + per-user isolation
    │   ├── test-monthly-8080.mjs  # monthly open/close + snapshot preservation
    │   ├── test-monthly-rules-8080.mjs # rules A-O: window, auto-close, reopen
    │   ├── test-time-rules.cjs # APP_TIMEZONE drives the current month
    │   ├── test-dashboard-history-8080.mjs # Test A: historical isolation
    │   ├── test-month-ownership-8080.mjs # Test C: month ownership + no cross-month leak
    │   └── test-e2e.mjs        # full journey through the Nginx proxy + cookie jar
    ├── browser/                # Playwright suites (run in a Docker image; see Testing)
    │   ├── package.json        # pins playwright@1.45.0 (browsers live in the image)
    │   ├── test-pw.cjs         # main browser journey
    │   ├── test-dashboard-installments.cjs
    │   ├── test-dashboard-series.cjs
    │   ├── test-monthly-ui.cjs
    │   ├── test-monthly-close-confirm.cjs
    │   └── test-mobile-pwa.cjs # mobile viewports + PWA/offline cache behaviour
    └── (node_modules/          # Playwright, gitignored - auto-installed on first run)
```

---

## Installation

### Prerequisites

- **Docker** and **Docker Compose v2** (`docker compose` plugin). Install via [Docker Engine docs](https://docs.docker.com/engine/install/).
- **Git** (to clone the repository).
- **Node.js ≥ 20** *only* if you want to run the backend locally instead of in Docker.
- Ports `8080` and `127.0.0.1:5433` free (see Troubleshooting if occupied).

### Steps

```bash
git clone <your-repo-url> Belanja
cd Belanja/app

# Create your environment file from the template
cp .env.example .env
```

Edit `.env` — **at minimum** change:

| Variable | Why you must change it |
| -------- | ---------------------- |
| `JWT_SECRET` | Required by compose (the `:?` guard fails startup if missing). Generate one with `openssl rand -hex 48`. |
| `POSTGRES_PASSWORD` | Default is a well-known example value; use your own. |
| `CLOUDFLARE_TUNNEL_TOKEN` | Only if you plan to use the tunnel; otherwise leave empty. |

Everything else can keep its default; adjust `APP_PORT`, `POSTGRES_PUBLISH_PORT`, `CORS_ORIGIN` and the rate limits if you need different values (see Environment Variables).

> **Never commit `.env`.** It is covered by `.gitignore`.

---

## Start Application

```bash
cd Belanja/app
docker compose up -d --build
```

Check everything came up:

```bash
docker compose ps
```

You should see three healthy services:

```
NAME                STATUS                       PORTS
belanja-backend-1   Up X minutes (healthy)        4000/tcp
belanja-db-1        Up X minutes (healthy)        127.0.0.1:5433->5432/tcp
belanja-nginx-1     Up X minutes                  0.0.0.0:8080->80/tcp
```

Interact with the application:

```bash
curl http://localhost:8080/api/health
# {"status":"ok","database":"connected","timestamp":"2026-09-24T…Z"}
```

Expected result: `status: "ok"` and `database: "connected"` (the health route pings the DB live). Then open **http://localhost:8080** in a browser and register an account.

---

## Stop / Restart

```bash
# Pause the stack (state preserved)
docker compose stop

# Resume a stopped stack
docker compose start

# Stop and remove containers/networks (volume data is KEPT)
docker compose down

# Full teardown including the database volume
docker compose down -v
```

> **⚠️ WARNING — `docker compose down -v` removes named volumes used by the project.** For Belanja that is `belanja_pg_data`, i.e. **ALL user data, expenses and closed months are permanently deleted**. Only use it if you truly want to wipe the database, and confirm your backups first (see Backup & Restore).

---

## Database Migration

Migrations are plain SQL files in `backend/db/migrations/`, sorted by numeric filename prefix (`001_…`, `002_…`, …). The runner (`backend/db/migrate.js`):

- creates the `schema_migrations` tracking table,
- applies each pending file inside its own transaction,
- takes a Postgres **advisory lock** so concurrent runs (e.g. several containers) are safe,
- records a SHA-256 **checksum** per file, and refuses to re-run a migration whose content changed ("never edit an applied migration").

### Automatic behavior

The backend applies migrations at startup when `NODE_ENV=production` **or** `RUN_MIGRATIONS=true` (both true in the Docker setup via `docker-compose.yml`).

### Manual migration

```bash
cd Belanja/app/backend
npm install                       # if not done already
export DATABASE_URL='postgres://belanja:YOUR_PASSWORD@127.0.0.1:5433/belanja'

npm run db:migrate                # apply pending migrations
npm run db:status                 # show APPLIED / PENDING per file
```

Expected output:

```
[migrate] done. 6 total, 0 applied, 6 already up-to-date.
```

### Adding a new migration

1. Create `backend/db/migrations/007_name_it.sql` (numeric prefix, then an underscore and a descriptive name).
2. Write the `CREATE TABLE ...` / `ALTER TABLE ...` (schema `belanja.`, `IF NOT EXISTS`/idempotent style if you expect re-runs) — and provide a `-- down` section if a rollback is needed.
3. Apply locally with `npm run db:migrate`; on deployment the existing flow (startup auto-migrate or the manual command) picks it up.

```bash
# Always write up/down and verify a fresh + re-run both work:
npm run db:migrate && npm run db:migrate   # second run: 0 applied
```

---

## Backup & Restore

These commands assume the compose project `belanja` is running.

### Backup (SQL dump) — recommended

```bash
cd Belanja/app
docker compose exec db pg_dump -U belanja -d belanja --no-owner --clean \
  > "belanja-backup-$(date +%F).sql"
```

Restore:

```bash
docker compose exec -T db psql -U belanja -d belanja < belanja-backup-2026-09-24.sql
```

### Volume-level backup

```bash
# Backup: tar the named volume to a host file
docker run --rm -v belanja_pg_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/belanja_pg_data_backup.tar.gz -C /data .

# Restore into a FRESH volume (machine first, then restore, then start db):
docker compose down -v              # ⚠️ wipes current data — restore into this fresh volume
docker compose up -d db             # starts empty postgres
docker compose stop db
docker run --rm -v belanja_pg_data:/data -v "$PWD":/backup alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/belanja_pg_data_backup.tar.gz -C /data"
docker compose up -d
```

> **⚠️ Volume restore is destructive** on the current `belanja_pg_data`. Take a fresh dump first, and only restore a `pg_dump`/volume snapshot you trust.

---

## Cloudflare Tunnel

Cloudflare Tunnel is an **optional** ask: it exposes the local app through a public HTTPS domain without opening inbound firewall ports.

```mermaid
flowchart LR
    Internet --> CF[Cloudflare edge]
    CF --> CT["cloudflared (tunnel)"]
    CT --> NGX[Nginx :8080]
    NGX --> BE[Backend :4000]
    BE --> PG[PostgreSQL :5432]
```

### Setup

1. Log in to **Cloudflare Zero Trust** → **Networks → Tunnels** → **Create a tunnel** (named, e.g. `belanja`).
2. Copy the **tunnel token** from the created tunnel (this is a secret — never commit or share it).
3. Put it in `.env`:

   ```env
   CLOUDFLARE_TUNNEL_TOKEN=eyJh…your-tunnel-token…
   ```

4. Start the stack with the tunnel profile:

   ```bash
   cd Belanja/app
   docker compose --profile tunnel up -d
   ```

5. Verify the extra container:

   ```bash
   docker compose ps cloudflared         # should be Up
   docker compose logs cloudflared       # "Registered tunnel connection"
   ```

6. In the Cloudflare dashboard add a **Public Hostname** entry for the route (subdomain/domain) → `http://belanja-nginx-1:80` (service `HTTP`, address `belanja-nginx-1`, port `80`), then open your Cloudflare URL in a browser.

> In `NODE_ENV=production` the CSP `upgrade-insecure-requests` directive is enabled, so pages served over the tunnel load all sub-resources as HTTPS automatically. Without a token, `cloudflared` starts with the harmless placeholder `not-configured` and simply idles — local access is unaffected.

---

## Environment Variables

All variables are read from `.env` (see `.env.example`). No real secrets are shown here.

| Variable | Purpose | Example |
| -------- | ------- | ------- |
| `NODE_ENV` | Runtime mode; `production` enables secure cookies + HTTPS upgrade | `development` / `production` |
| `PORT` | Backend listen port (inside container / local runs) | `4000` |
| `APP_PORT` | Host port where Nginx/frontend is exposed | `8080` |
| `CORS_ORIGIN` | Extra allow-listed cross-origin origins (comma-separated); same-origin is always allowed | `http://localhost:8080` |
| `JWT_SECRET` | HMAC key signing session tokens (**required**, generate w/ `openssl rand -hex 48`) | `a-long-random-hex-string…` |
| `JWT_EXPIRES_IN` | Token/cookie lifetime | `7d` |
| `RATE_LIMIT_AUTH` | `/api/auth` requests / 15 min per IP (includes `/me` on each page load) | `300` |
| `RATE_LIMIT_AUTH_LOGIN` | Strict login+register attempts / 15 min per IP | `30` |
| `RATE_LIMIT_API` | All other `/api` requests / 15 min per IP | `600` |
| `POSTGRES_USER` | Postgres superuser for the `db` service | `belanja` |
| `POSTGRES_PASSWORD` | Postgres password (**change it**) | `belanja-strong-password` |
| `POSTGRES_DB` | Database name | `belanja` |
| `POSTGRES_SCHEMA` | Application schema the backend uses | `belanja` |
| `POSTGRES_PUBLISH_PORT` | Host-only port published for Postgres | `127.0.0.1:5433` |
| `DATABASE_URL` | Backend connection string (used for local non-Docker runs; compose builds its own with host `db`) | `postgres://belanja:…@localhost:5432/belanja` |
| `CLOUDFLARE_TUNNEL_TOKEN` | Cloudflare tunnel token (optional; profile `tunnel`) | *(empty by default)* |
| `RUN_MIGRATIONS` | Auto-apply migrations at backend startup (compose sets `true`) | `true` |

---

## API Documentation

Base URL: `http://localhost:8080/api`. All routes are mounted under this path; responses are JSON `{ status: 'ok', … }` (or `{ status: 'error', error, message, details? }` on failure). Authentication is via the httpOnly `belanja_token` cookie, or the `Authorization: Bearer <token>` header.

### Health

| Method | Endpoint | Auth | Purpose |
| ------ | -------- | ---- | ------- |
| GET | `/api/health` | No | Live DB connectivity + uptime probe |

```bash
curl http://localhost:8080/api/health
```
```json
{"status":"ok","database":"connected","timestamp":"2026-09-24T06:49:06.314Z"}
```

### Authentication

| Method | Endpoint | Auth | Purpose |
| ------ | -------- | ---- | ------- |
| POST | `/api/auth/register` | No | Create account; sets session cookie |
| POST | `/api/auth/login` | No | Verify credentials; sets session cookie |
| POST | `/api/auth/logout` | No | Clear session cookie |
| GET | `/api/auth/me` | Yes | Current user profile |
| PUT | `/api/auth/me` | Yes | Update name |

```bash
curl -X POST http://localhost:8080/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ali","email":"ali@example.com","password":"password123"}'
```
```json
{
  "status": "ok",
  "token": "<jwt>",
  "user": { "id": "…", "name": "Ali", "email": "ali@example.com", "createdAt": "…" }
}
```

### Fixed Expenses

| Method | Endpoint | Auth | Purpose |
| ------ | -------- | ---- | ------- |
| GET | `/api/fixed-expenses` | Yes | List masters |
| POST | `/api/fixed-expenses` | Yes | Create |
| PUT | `/api/fixed-expenses/:id` | Yes | Update |
| PATCH | `/api/fixed-expenses/:id/active` | Yes | Enable/disable (body `{"active":true}`) |
| DELETE | `/api/fixed-expenses/:id` | Yes | Delete |

Body: `{ "name": "Rent", "type": "property", "amount": 1910, "remarks?" }`. Types: `bank`, `shopee_paylater`, `tiktok_paylater`, `credit_card`, `bill`, `property`, `vehicle`, `hutang_orang`, `others`.

### Variable Expenses

| Method | Endpoint | Auth | Purpose |
| ------ | -------- | ---- | ------- |
| GET | `/api/variable-expenses` | Yes | List all, or `?year=2026&month=9` for one month |
| POST | `/api/variable-expenses` | Yes | Create (refused with `409` if month is CLOSED) |
| PUT | `/api/variable-expenses/:id` | Yes | Update (refused if its month is CLOSED) |
| DELETE | `/api/variable-expenses/:id` | Yes | Delete (refused if its month is CLOSED) |

Body: `{ "name": "Lunch", "type": "food", "amount": 8.5, "expenseDate": "2026-09-24", "remarks?" }`. Types: `food`, `groceries`, `parent`, `toll`, `fuel`, `others`.

### Installments

| Method | Endpoint | Auth | Purpose |
| ------ | -------- | ---- | ------- |
| GET | `/api/installments` | Yes | List loans |
| POST | `/api/installments` | Yes | Create |
| PUT | `/api/installments/:id` | Yes | Update |
| PATCH | `/api/installments/:id/active` | Yes | Pause/resume |
| DELETE | `/api/installments/:id` | Yes | Delete |

Body: `{ "loanName": "iPad", "type": "bank", "amount": 4500, "monthlyInstallment": 250, "totalMonths": 18, "paidMonths": 9, "startDate?", "endDate?", "active?" }`. `remaining_months` is returned and DB-generated.

### Monthly

| Method | Endpoint | Auth | Purpose |
| ------ | -------- | ---- | ------- |
| GET | `/api/monthly/current` | Yes | Server's current (year, month) in `APP_TIMEZONE` |
| GET | `/api/monthly/:year/:month` | Yes | Monthly detail (read-only — never creates an entry; snapshot values if CLOSED, live preview if current&nbsp;&amp;&nbsp;NOT&nbsp;OPEN) |
| POST | `/api/monthly/:year/:month/open` | Yes | Open the current month (only the current calendar month is openable) |
| POST | `/api/monthly/:year/:month/close` | Yes | Close the month (idempotent; snapshots active fixed + installments) |
| POST | `/api/monthly/:year/:month/reopen` | Yes | Reopen a closed month inside the editable window (current and previous 3 months) |

```bash
curl -X POST http://localhost:8080/api/monthly/2026/9/open
curl -X POST http://localhost:8080/api/monthly/2026/9/close
curl -X POST http://localhost:8080/api/monthly/2026/8/reopen
```
```json
{
  "status": "ok",
  "alreadyClosed": true,
  "message": "Month was already closed and is read-only.",
  "entry": { "id": "…", "year": 2026, "month": 9, "status": "CLOSED", "closedAt": "…" },
  "fixedExpenses": [ { "name": "House Rent", "type": "property", "amount": 1910 } ],
  "installments": [ { "loanName": "iPad", "type": "bank", "monthlyInstallment": 250 } ],
  "variableExpenses": [],
  "totals": { "fixed": 1910, "installments": 250, "variable": 0, "total": 2160 }
}
```

### Dashboard

| Method | Endpoint | Auth | Purpose |
| ------ | -------- | ---- | ------- |
| GET | `/api/dashboard` | Yes | Current-month totals, 12-month series, active installments |

```json
{
  "status": "ok",
  "currentMonth": { "year": 2026, "month": 9, "label": "Sep 2026", "status": "OPEN" },
  "totals": { "fixed": 1910, "installments": 250, "variable": 8.5, "total": 2168.5 },
  "series": [ { "year": 2025, "month": 10, "label": "Oct", "fixed": 0, "installments": 0, "variable": 0, "total": 0 } /* …12 months… */ ],
  "installments": [ { "loanName": "iPad", "monthlyInstallment": 250, "totalMonths": 18, "paidMonths": 9, "remainingMonths": 9, "progress": 50 } ],
  "unpaidTotal": 2250,
  "summary": { "fixedExpenseCount": 1, "installmentCount": 1, "variableExpenseCount": 1, "activeInstallmentCount": 1 }
}
```

---

## Security

Verified in code:

- **Password hashing** — `bcryptjs` with **12 rounds** (`services/authService.js`); only the hash is stored; emails normalized to lowercase.
- **Authentication** — signed JWTs (`sub` = user id), delivered as **httpOnly + SameSite=Strict** cookies, `Secure` in production. The `user_id` in SQL always comes from the verified token, never the request body.
- **User isolation** — every query filters by `user_id`; cross-user IDs are invisible (`404`). All user tables `ON DELETE CASCADE` from `users`.
- **SQL injection defense** — all statements use parameterized `pg` queries; the pool pins `search_path` to the `belanja` schema.
- **Rate limiting** — `express-rate-limit` keyed on the client IP (correctly resolved behind Nginx via forwarded headers): 30/15-min for login+register, 300/15-min for all `/api/auth`, 600/15-min for the rest of `/api`.
- **CORS** — same-origin requests are always allowed (host-aware, so LAN IP/Cloudflare domains work); true cross-origin needs an entry in `CORS_ORIGIN`; disallowed origins get `403`.
- **Security headers** — Helmet: CSP (`script-src 'self'`, `frame-ancestors 'none'`, optional upgrade-insecure-requests in production), `cross-origin-resource-policy: same-origin`, plus defaults.
- **Cache-Control** — every `/api` response is sent with `Cache-Control: no-store` (personal financial data is never cached or heuristically revalidated); `etag` disabled.
- **Secrets** — `JWT_SECRET` and DB credentials live only in `.env` (gitignored); compose refuses to start without `JWT_SECRET`.
- **Process hardening** — backend runs as the non-root `node` user in the container; Nginx hides its version (`server_tokens off`); JSON body limit `100kb`; centralized error handler never leaks stack traces or DB internals (maps PG codes `23505`/`23503` → `409`, `23514`/`23502`/`22001`/`22P02` → `400`).

---

## Testing

All suites below pass against the running native Termux backend (started with `./scripts/start-termux.sh`, migrations auto-applied). The tests are committed in the repository under `app/tests/` and are driven from the project root (`app/`) via the scripts in `app/package.json`.

**Before running:** start the app first — `./scripts/start-termux.sh`. The API suites need only `node` (point them at the running app with `BASE_URL=http://127.0.0.1:3000 npm test:api`); the browser suites additionally need **Docker** (they launch Chromium inside the Playwright image) and a `host.docker.internal` mapping (`--add-host` is already in the scripts), with `BASE_URL` set to the app's host port.

### Run everything

```bash
cd Belanja/app
npm test        # test:api first, then test:browser
```

### Individual suites

| Suite | Command | What it covers | Latest result |
| ----- | ------- | -------------- | ------------- |
| CRUD + auth + isolation | `npm run test:api:crud` | register/login/me/logout, fixed/variable/installment CRUD, toggle active, duplicate email, wrong-password, *per-user isolation*, validation & 404s | **ALL TESTS PASSED** |
| Monthly & snapshots | `npm run test:api:monthly` | no auto-open on GET, explicit open, OPEN totals, close month, snapshot preservation after master edits, idempotent re-close, closed-month `409`, reopen + auto-close, dashboard series (empty months stay 0, closed snaps), independent months | **ALL TESTS PASSED** |
| Monthly business rules | `npm run test:api:rules` | rules A–O: read-only GET, open-only-current, future `400`s, reopen window (3 months back), outside-window `409`, lazy auto-close of stale OPEN months, reopen keeps snapshot, no duplicate snapshots, per-user isolation, dashboard consistency | **ALL RULES TESTS PASSED** |
| Timezone rules | `npm run test:api:time` | `APP_TIMEZONE` drives the current month (KL = UTC+8 month-boundary case), UTC fallback on invalid tz, `monthIndex` arithmetic | **ALL TESTS PASSED** |
| Dashboard history isolation | `npm run test:api:dash-history` | regression (Test A): a historical month never inherits the current month's live recurring total — CLOSED w/ empty snapshot stays `0`, CLOSED w/ its own snapshot plots the SNAPSHOT value (not live), historical OPEN plots only its own variable expenses; current OPEN month keeps the live total | **ALL DASHBOARD-HISTORY TESTS PASSED** |
| Monthly month ownership | `npm run test:api:month-ownership` | regression (Test C): every expense month is owned by its intended month — current month is 2026-09; a new expense belongs to `(2026,9)` in the API *and* the DB row; August stays `0` (fixed AND installments `0`, no snapshot, no leak of September totals); future October returns `0`/read-only and writes `400`; closing September creates a snapshot **under September**; reopen→close keeps it under September with exactly one snapshot row (no duplicates); lifecycle unchanged (no auto-open, stale OPEN auto-close, reopen window) | **ALL MONTH-OWNERSHIP TESTS PASSED** |
| End-to-end via Nginx | `npm run test:api:e2e` | static pages, `/api` proxy, register→me→fixed→monthly→dashboard→logout over real cookies | **ALL E2E TESTS PASSED** |
| All API suites | `npm run test:api` | crud → monthly → monthly-rules → time-rules → dashboard-history → month-ownership → e2e in sequence | **ALL TESTS PASSED** |
| Browser — main journey | `npm run test:browser:main` | Chromium: register → dashboard cards + 12-bar chart → add fixed + installment → open month → monthly total RM2,168.50 → close → snapshot preserved after edit → read-only month → profile → logout → no console errors | **ALL BROWSER TESTS PASSED (16/16)** |
| Browser — active installments | `npm run test:browser:installments` | dashboard installments render as real cards (regression: literal-source-text bug) + XSS probe (hostile loan name never executes / never injects markup) | **ALL DASHBOARD INSTALLMENT CHECKS PASSED (11/11)** |
| Browser — monthly series | `npm run test:browser:series` | regression: previous month stays `0`, current month never inherits another month's total, read-only GET creates nothing, range label renders a real en-dash `–` (not `&ndash;`) | **ALL REGRESSION CHECKS PASSED (11/11)** |
| Browser — monthly UI lifecycle | `npm run test:browser:monthly-ui` | Chromium: NOT OPEN → Open (badge + buttons) → FUTURE read-only → back to OPEN → close → reload stays closed → reopen → add expense → ancient month untouched → no console errors | **ALL UI TESTS PASSED** |
| Browser — close confirm | `npm run test:browser:close-confirm` | regression (Test B): Open / Close / Reopen confirmations name the real month — `Close September 2026?` when the current month is 2026-09 (no `?year=&month=` params, no `December 1899`), correct across hard-reload & the reopen→close cycle | **ALL CLOSE-CONFIRM TESTS PASSED** |
| Browser — mobile + PWA | `npm run test:browser:mobile-pwa` | Chromium at 375×667, 390×844 and 412×915: login/dashboard/monthly/fixed/installments/profile show **no horizontal overflow**; bottom navigation (Dashboard \| Monthly \| Expenses \| More) works; monthly Open/Add/Close/Reopen confirm the real month name; tables render as labelled mobile cards; **PWA**: manifest (name/display/theme/icons/maskable), service worker registers + controls the page, static assets precached and served from cache **while offline**, `/api/*` never cached, cached page shells render offline (stale-while-revalidate) with the offline fallback page for unknown paths, no localStorage user data | **ALL MOBILE+PWA TESTS PASSED** |
| All browser suites | `npm run test:browser` | the six suites above in sequence | **ALL BROWSER SUITES PASSED** |
| Health check | `curl http://localhost:8080/api/health` | DB connectivity | `"status":"ok","database":"connected"` |

### How the browser suites run

There is no system browser on this WSL host, so the browser suites run inside the official Playwright image, which already ships the matching Chromium at `/ms-playwright/`:

```bash
npm run test:browser            # runs all six via Docker
# or a single suite:
npm run test:browser:series
```

Behind the scenes each script runs:

```bash
docker run --rm \
  --add-host host.docker.internal:host-gateway \
  -e BASE_URL='http://host.docker.internal:8080' \
  -v "$PWD/tests/browser:/app" -w /app \
  mcr.microsoft.com/playwright:v1.45.0-noble \
  sh -c "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1; test -d node_modules/playwright || npm install --no-audit --no-fund; node <suite>.cjs"
```

- `app/tests/browser/package.json` pins `playwright@1.45.0` (locked via `package-lock.json`). The `npm install` runs automatically on first run into the mounted `tests/browser/node_modules` (gitignored) with browser download skipped, because the container already provides the browser binaries.
- The app is reached through nginx at `host.docker.internal:8080`.

### Data hygiene

- Tests create throwaway accounts with unique, per-run email addresses (`alice1234@test.local`, `browser5678@t.local`, …) and never touch real users, existing records, or closed months.
- The suites write **no files** (no logs, dumps, cookie jars) — there is nothing to clean up afterward; leftover `node_modules/` in `tests/browser/` is developer cache and is gitignored.

---

## Troubleshooting

| Problem | Possible cause | Diagnose | Solution |
| ------- | -------------- | -------- | -------- |
| `docker compose up` fails | Malformed `.env` / missing secret | `docker compose config` | Fix `.env`; ensure `JWT_SECRET` present |
| Backend exits "Missing required environment variable" | `JWT_SECRET` or `DATABASE_URL` not set | `docker compose config \| grep -i jwt` | Set `JWT_SECRET`; compose builds `DATABASE_URL` itself |
| Backend never becomes healthy | DB unreachable or migrations failing | `docker compose logs backend` | Start `db` first (`docker compose up -d db`), wait healthy; check `db` logs |
| `backend` stuck "Starting (Waiting)" | `db` healthcheck failing | `docker compose logs db` | Wrong creds/volume; check `POSTGRES_PASSWORD` math between `.env` and volume |
| Port 8080 already in use | Another process/container | `docker compose ps`, `ss -ltnp \| grep 8080` | Change `APP_PORT` in `.env`, recreate nginx |
| Port 5433 already in use | Another Postgres | `docker compose ps` | Change `POSTGRES_PUBLISH_PORT`, recreate db |
| Nginx not proxying /api | Backend down | `curl -v http://localhost:8080/api/health` | `docker compose up -d --build backend`, re-check health |
| `cloudflared` not connected | Token missing/invalid | `docker compose logs cloudflared` | Set `CLOUDFLARE_TUNNEL_TOKEN` in `.env`; check tunnel in Zero Trust dashboard |
| Migration failed "already applied with different content" | An applied SQL file was edited | `npm run db:status` | Never edit applied files; add `00X_new.sql` instead |
| Login "401 Invalid email or password" | Wrong creds / case | — | Emails are lowercased; check the email is registered (register returns `409` if it exists) |
| Login/register returns `429 Too Many Requests` | Rate limit hit (30/15-min per IP) | `docker compose logs backend` | Wait for the window or restart the backend container (in-memory limiter) |
| API calls fail in a real browser but work with curl | CORS origin rejected | Check browser console for `403 Request origin is not allowed` | Reached from a new host (e.g. `http://192.168.x.x:8080`)? Same-origin is auto-allowed; for true cross-origin add to `CORS_ORIGIN` |
| Browser shows cached/old data | Browser cache of static assets | hard-reload | Static assets cache 1h (nginx); `/api` is `no-store` |

### Useful log commands

```bash
docker compose logs
docker compose logs backend
docker compose logs nginx
docker compose logs db
docker compose logs cloudflared
```

---

## Development Workflow

Recommended loop for contributing to the app:

1. **Modify code** — backend under `app/backend`, frontend under `app/frontend`, nginx config under `app/nginx`.
2. **Syntax-check backend** — `cd app/backend && npm run check` (or `node --check <file>` for individual files).
3. **Rebuild image** — `docker compose up -d --build backend` (frontend + nginx config are volume-mounted, so `docker compose restart nginx` suffices for those).
4. **Start the stack** — `docker compose up -d` and wait for `backend` to be `(healthy)`.
5. **Test the API** — `npm run test:api` (or a single suite with `test:api:crud` / `test:api:monthly` / `test:api:e2e`) and `curl http://localhost:8080/api/health`.
6. **Test the browser** — `npm run test:browser` (or a single suite with `test:browser:main` / `test:browser:installments` / `test:browser:series`).
7. **Review logs** — `docker compose logs -f backend`.
8. **Commit** — stage only intended files, never `.env`.

```bash
# Quick iteration
cd Belanja/app
docker compose up -d --build backend    # rebuild backend
docker compose restart nginx            # reload mounted nginx.conf (or `nginx -s reload`)
docker compose logs -f backend          # watch API logs live
docker compose logs -f nginx            # watch proxy/access logs live
```

> The `db` service rarely needs attention once initialized; keep migrations additive.

---

## Git Workflow

Basic GitHub flow for this repository:

```bash
git status          # what changed
git add .           # stage all changes (do NOT commit .env — it's gitignored)
git commit -m "Describe your change concisely"
git push origin main
```

```bash
# Keep a tidy history
git log --oneline
git pull --rebase origin main
```

> `.gitignore` already excludes `.env`, `node_modules`, logs and OS junk, so `.env.example` (not `.env`) is what gets committed.

---

## Future Roadmap

> The items below are **future ideas** — none of them are implemented in Belanja yet.

- **Budget limits** — per-category monthly budgets with progress/overspend indicators.
- **Expense reports** — printable monthly summaries and PDF export.
- **CSV/Excel export** — download any month or year range.
- **Recurring variable expense automation** — templates so "daily lunch" can be added quickly.
- **Reopening / roll-over months** — explicit reopen flow or auto-creating next month's entry.
- **Notifications / reminders** — due-date reminders for installments and fixed bills.
- **Multi-currency support** — beyond MYR.
- **Dark mode** — theme toggle for `style.css`.
- **PWA / mobile support** — offline read-only views and "add to home screen".
- **Production hardening** — database-backed rate limiting, automated backup scheduling, email verification / password reset.