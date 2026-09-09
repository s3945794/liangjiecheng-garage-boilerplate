# TideCloak — Local Development

> **Project:** SOC Incident Report Protection PoC (`feature/tidecloak-auth`).
>
> The work is phased. This document reflects **only what has actually been done
> and verified**. The local realm and application client below were created
> **interactively** with TideCloak's built-in wizard and confirmed by a manual
> runtime test; they are **not** yet reproducible by a script on another
> machine.

| Phase | Scope | Status |
|-------|-------|--------|
| **1A** | Local TideCloak **container foundation** + **interactive** realm / client provisioning via the built-in wizard | **Done and verified by manual runtime test** |
| **1B** | The four SOC **roles**, adapter-JSON export, and a **reproducible / scripted** realm setup | Not started — scripted path still unavailable (see ISSUE 005) |
| Later | **Frontend + backend authentication migration** — TideCloak provider, redirect handler, route/API protection, server-side JWT verification, role checks; removal of Firebase Authentication | Not started |

---

## Why Docker — and why only for TideCloak

This boilerplate is deliberately Docker-free: `pnpm install` plus a free
Firebase project is the whole setup, and the app always talks to real Firebase
(no emulators, no containers).

TideCloak is different. It is a stateful identity server (Keycloak + the Tide
threshold-cryptography protocol) with **no free hosted tier suitable for local
development**. The Tide playbooks run it as a local container. So this repo adds
**exactly one** container, for TideCloak alone:

| Component | How it runs | Containerised? |
|-----------|-------------|----------------|
| Frontend (Next.js) | `pnpm run dev` — host process | No |
| Backend (Express/Functions) | host process | No |
| Firestore | real Firebase project | No |
| **TideCloak** | **Docker container (`docker-compose.tidecloak.yml`)** | **Yes — the only one** |

The frontend, backend and Firestore are **not** containerised. This is a scoped
exception to the no-Docker rule in `CLAUDE.md`, not a migration to Docker
Compose for the stack.

The image is `tideorg/tidecloak-dev:latest` — despite the `-dev` suffix this is
the production image and the only one the Tide pack supports. Do not substitute
`tideorg/tidecloak-stg-dev` or any `-stg` build.

---

## Phase 1A — start / stop the TideCloak container

### Prerequisites

- Docker Desktop running (`docker info` succeeds).
- Port `8080` free.
- Root `.env` with **both** of these set (no defaults exist):

  ```dotenv
  KC_BOOTSTRAP_ADMIN_USERNAME=      # choose your own
  KC_BOOTSTRAP_ADMIN_PASSWORD=      # choose a strong one
  ```

  `.env` is gitignored. `.env.example` carries these as **empty placeholders**.
  These two variables are read straight from `.env` by Docker Compose and are
  intentionally **not** synced into `frontend/.env.local` / `backend/.env`.

### Commands

```bash
cp .env.example .env            # if you don't have a .env yet
# edit .env → set KC_BOOTSTRAP_ADMIN_USERNAME and KC_BOOTSTRAP_ADMIN_PASSWORD

pnpm run tidecloak:start        # start; waits for http://localhost:8080
pnpm run tidecloak:status       # container state + HTTP probe
pnpm run tidecloak:logs         # follow logs
pnpm run tidecloak:stop         # stop; the ./data volume is KEPT
```

- `tidecloak:start` **stops with a clear message** if either credential is
  missing or blank — it never falls back to a default username or password.
- Credentials are passed to Docker via the environment only. The wrapper never
  prints, logs, or writes them.
- `tidecloak:stop` runs `docker compose stop <service>` — it does **not** delete
  the `./data` volume, so realm state survives a stop/start.
- The service has **no restart policy**: it runs only when you explicitly start
  it and does **not** auto-start when Docker Desktop launches.
- There is deliberately **no** `reset`/`wipe` command. To start clean: stop the
  container, delete `data/keycloakdb*`, start again.
- Container data lives in `./data` (bind mount, gitignored). Do not commit it
  and do not point another environment at the same directory.

### Verified runtime test

A manual end-to-end test on the local machine confirmed:

| # | Observation |
|---|-------------|
| 1 | `pnpm run tidecloak:start` started the container `liangjiecheng-garage-boilerplate-tidecloak-1`. |
| 2 | TideCloak answered at `http://localhost:8080`; the readiness probe returned **HTTP 302**. |
| 3 | The fixed Compose config (no `container_name:`) **did not touch** the older, unrelated global container named `tidecloak`. |
| 4 | The developer signed in with the local bootstrap administrator. |
| 5 | The built-in **"Create a Tide realm"** wizard created and provisioned realm `soc-incident-report-protection` with client ID `soc-incident-report-protection-app`. |
| 6 | A **separate** Tide account was linked during enrollment (see "Two identities" below). |
| 7 | Ragnarok / offboarding was **not** enabled. |
| 8 | The application client was configured (see "Application client" below). |
| 9 | Saving the client created **five** TideCloak QEA changes; all five were reviewed and authorized. |
| 10 | `pnpm run tidecloak:stop` stopped **only** the project's container and kept `./data`. |
| 11 | After a second `pnpm run tidecloak:start`, the realm and application client were **still present** — local persistence confirmed. |
| 12 | TideCloak was stopped safely after testing. |

### Realm created (interactively)

Realm: **`soc-incident-report-protection`** — created and provisioned by
TideCloak's built-in **"Create a Tide realm"** wizard. The wizard set up the
realm, the Tide connection, the licence, the linked administrator, the
application client, and the QEA (governed-change) workflow **without a
separately downloaded realm template**.

**The interactive wizard is the confirmed local-development setup path for this
project.** See ISSUE 005 in `docs/tide-mcp-learning.txt`.

### Application client (confirmed configuration)

| Field | Value |
|-------|-------|
| Client ID | `soc-incident-report-protection-app` |
| Name | `SOC Incident Report Protection` |
| Base URL | `http://localhost:3000` |
| Public client | Enabled |
| Standard flow / Authorization Code | Enabled |
| Direct access grants | Disabled |

Valid redirect URIs:

```
http://localhost:3000/*
http://localhost:3000/auth/redirect
http://localhost:3000/silent-check-sso.html
http://localhost:3000
```

Web origin:

```
http://localhost:3000
```

> ⚠️ The wizard's **"Redirect URI"** field behaved like an application **base
> URL**: given `http://localhost:3000/auth/redirect` it generated mangled
> entries such as `http://localhost:3000/auth/redirect/auth/redirect` and set
> the web origin to `http://localhost:3000/auth/redirect`. The values above are
> the **corrected** ones, entered by setting the base URL to
> `http://localhost:3000` and fixing the redirect URIs / web origin by hand
> before saving. Full detail: `docs/tide-mcp-learning.txt` → ISSUE 006.

The five authorized QEA changes were:

- Update protocol mapper
- Set client attribute
- Update client web origins
- Update client redirect URIs
- Update client property

### Two identities: bootstrap admin vs linked Tide account

These are **separate** identities and must not be conflated:

- **Local bootstrap administrator** — the `KC_BOOTSTRAP_ADMIN_USERNAME` /
  `KC_BOOTSTRAP_ADMIN_PASSWORD` pair from `.env`. It exists only in the local
  container's master realm and is how you reach the admin console.
- **Linked Tide account** — a distinct account bound to the Tide Fabric during
  the wizard's enrollment step. It is the cryptographic identity that authorizes
  governed (QEA) changes. Its name / email are **not recorded here**.

### Where the realm lives

The realm, client and QEA history are stored in the container's H2 database
under **`./data`**, which is **gitignored** (`/data/`). It contains
environment-specific state and must **never** be committed. It is not portable:
copying `./data` to another machine is not a supported setup path.

### Not done yet in Phase 1A

- The four SOC **roles** (`soc-analyst`, `soc-supervisor`, `soc-team-leader`,
  `soc-manager`) have **not been created**. Their confirmed design is in
  [`../tidecloak/roles.json`](../tidecloak/roles.json) (realm roles; display
  names are UI labels only).
- The adapter JSON has **not** been exported.
- No Next.js or Express authentication code has been touched.
- **Firebase Authentication has not been removed** — it is still the app's only
  auth authority.

---

## Phase 1B — roles, adapter export, and reproducible setup (not started)

Still to do:

1. Create the four SOC **realm** roles from
   [`../tidecloak/roles.json`](../tidecloak/roles.json) and authorize the
   resulting QEA changes.
2. Export the adapter JSON (`vendorResources/get-installations-provider`) to
   `data/tidecloak.json` (gitignored).
3. Establish a **reproducible / scripted** realm setup so a teammate can
   recreate the realm on a clean machine.

### Reproducible setup is still an open problem

The interactive wizard is **not** scripted, exportable, or reproducible on
another computer as-is. A scripted path needs either an **exportable canonical
realm template** or a **documented automation API** from Tide — neither was
available through the focused Tide MCP resources
(`start-tidecloak-dev`, `bootstrap-realm-from-template`,
`initialize-admin-and-link-account`, `version-policy`) or a direct
`tide_scenario_bootstrap` request. See `docs/tide-mcp-learning.txt` → ISSUE 005.

Until that exists: **do not hand-write a `realm.json`**. The
`bootstrap-realm-from-template` playbook explicitly forbids a minimal
substitute (it would be missing `link-tide-account-action` and the Tide IdP
mapper), and the wizard already produces a correct realm interactively.

### IGA / QEA scope note

The governed-change (QEA) approvals you authorize in the wizard are **Tide's
realm-setup requirement** — they make governance approvals cryptographically
sealed rather than server-enforced. They are **not** the application-facing IGA
admin panel / approval UI, which is **out of scope** for this PoC (see
`docs/tide-mcp-learning.txt` → ISSUE 001).

---

## Later phase — application authentication migration (not started)

Frontend and backend authentication still use **Firebase Authentication**,
unchanged. Migrating to TideCloak — provider, redirect handler, route
protection, backend JWT verification (EdDSA), role checks, and removal of the
Firebase auth surface — is a later phase and touches no application code yet.
Firestore is kept as the database throughout.

Full end-to-end login verification against the realm above can only happen
**after** the Next.js authentication code is implemented.

---

## Credentials & secrets stay local

- Real credentials live **only** in the root `.env`, which is gitignored.
- `.env.example` carries **placeholder names only** —
  `KC_BOOTSTRAP_ADMIN_USERNAME=` / `KC_BOOTSTRAP_ADMIN_PASSWORD=`, both empty.
- `KC_BOOTSTRAP_ADMIN_*` are **not** synced into `frontend/.env.local` or
  `backend/.env` (`scripts/sync-env.js` does not reference them).
- Never pass the admin password on the command line or hard-code it in a
  script — it would land in shell history, `ps` output and CI logs.
- The linked Tide account's name / email are never written into a tracked file.
- Gitignored TideCloak paths: `/data/`, `data/tidecloak.json`,
  `tidecloak/*.local.json`, `tidecloak/realm.json.template`,
  `*.tidecloak-adapter.json`, plus the repo-wide `*.pem` / `*.key` /
  `*-token.json` / `*-credentials.json` rules.
