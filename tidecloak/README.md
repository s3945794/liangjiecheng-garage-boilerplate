# TideCloak — local development (SOC Incident Report Protection PoC)

Local-only TideCloak setup for the PoC. Nothing here is wired into the running
application. A local realm and application client **do** exist now — they were
created **interactively** with TideCloak's built-in wizard and verified by a
manual runtime test (details in `../docs/TIDECLOAK-LOCAL.md`).

- **Full explanation & phasing:** [`../docs/TIDECLOAK-LOCAL.md`](../docs/TIDECLOAK-LOCAL.md)
- **Compose file:** [`../docker-compose.tidecloak.yml`](../docker-compose.tidecloak.yml)
- **Control wrapper:** [`../scripts/tidecloak.js`](../scripts/tidecloak.js)

## What is here

| File | Purpose |
|------|---------|
| `../docker-compose.tidecloak.yml` | One TideCloak container, `tideorg/tidecloak-dev:latest`, port 8080, bind mount `./data`. No fixed `container_name`, no restart policy. |
| `../scripts/tidecloak.js` | `start` / `stop` / `status` / `logs` wrapper. Refuses to start without both admin env vars. Drives the Compose **service** `tidecloak`, never a global container name. |
| `roles.json` | The **confirmed** realm design: four **realm** roles + UI display names. Declarative reference — **not created yet**. |

## Why Docker here (and only here)

The boilerplate is deliberately Docker-free. TideCloak is a stateful identity
server with no free hosted tier for local dev, so it runs in **one** container.
The frontend, backend and Firestore are **not** containerised and keep running
with `pnpm run dev` against the real Firebase project. Scoped exception, not a
move to Docker Compose for the stack.

## Commands

```bash
pnpm run tidecloak:start     # start the container (validates .env first)
pnpm run tidecloak:stop      # stop it — the ./data volume is kept
pnpm run tidecloak:status    # container state + HTTP probe on :8080
pnpm run tidecloak:logs      # follow container logs
```

Prerequisites: Docker Desktop running, port `8080` free, and **both**
`KC_BOOTSTRAP_ADMIN_USERNAME` and `KC_BOOTSTRAP_ADMIN_PASSWORD` set in the root
`.env` (gitignored). There is no default for either — `tidecloak:start` stops
with a clear message if either is missing. Real credentials never go on the
command line, into a script, or into any tracked file.

The container has **no restart policy**: it runs only when you explicitly start
it and does not come back when Docker Desktop launches.

Verified locally: `pnpm run tidecloak:start` started
`liangjiecheng-garage-boilerplate-tidecloak-1`, TideCloak answered at
`http://localhost:8080` (readiness probe: HTTP 302), and the older unrelated
global `tidecloak` container was not touched. After `stop` then `start` again,
the realm and client were still present — local state persists under `./data`.

## Local realm setup — use the built-in wizard

The `bootstrap-realm-from-template` playbook wants a **canonical realm
template**, which was not available through the focused Tide MCP resources or a
direct `tide_scenario_bootstrap` request (see
`../docs/tide-mcp-learning.txt` → ISSUE 005).

**The installed TideCloak version provides a built-in "Create a Tide realm"
wizard, and that is the confirmed local-development setup path here.** The
wizard provisioned — without any downloaded template — the:

- realm `soc-incident-report-protection`
- Tide connection + licence
- linked administrator (enrollment)
- application client `soc-incident-report-protection-app`
- QEA (governed-change) workflow

Ragnarok / offboarding was left **disabled**.

### Application client (confirmed)

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

Web origin: `http://localhost:3000`

> ⚠️ The wizard's **"Redirect URI"** field behaves like an application **base
> URL** and appends callback / silent-SSO paths to whatever you type — entering
> the exact callback produced a mangled `.../auth/redirect/auth/redirect`. Set
> the base URL to `http://localhost:3000` and correct the redirect URIs / web
> origin by hand before saving. See `../docs/tide-mcp-learning.txt` → ISSUE 006.

Saving the client produced **five** QEA changes (update protocol mapper, set
client attribute, update client web origins, update client redirect URIs,
update client property) — all reviewed and authorized.

### Two separate identities

- **Local bootstrap admin** — the `.env` username/password. Local master-realm
  account for reaching the admin console.
- **Linked Tide account** — a distinct Fabric-bound identity created during
  wizard enrollment; it authorizes governed (QEA) changes. Its name/email are
  not recorded in this repo.

## Realm design (confirmed — roles NOT created yet)

Realm: **`soc-incident-report-protection`**

| Role ID (in tokens — authoritative) | Display name (UI only) |
|-------------------------------------|------------------------|
| `soc-analyst`       | SOC Analyst |
| `soc-supervisor`    | SOC Supervisor |
| `soc-team-leader`   | SOC Team Leader |
| `soc-manager`       | SOC Manager |

All four are **realm** roles. See [`roles.json`](roles.json). **None of them
have been created in the realm yet** — that is the next step.

## Still to do

- **Create the four SOC roles** and authorize the resulting QEA changes.
- Export the adapter JSON to `data/tidecloak.json` (gitignored).
- **Reproducible setup:** the wizard is interactive only. Scripted realm
  recreation on another machine is **still unavailable** — it needs an
  exportable template or a documented automation path from Tide. Do not
  hand-write a `realm.json`.
- **Application auth migration (later):** Frontend and backend authentication
  still use Firebase Authentication, unchanged. **Firebase Authentication has
  not been removed.** Swapping in TideCloak (provider, redirect handler,
  route/API protection, JWT verification) touches no code yet, and end-to-end
  login can only be verified once the Next.js auth code exists.

## Not portable

The realm, client and QEA history live in the container's H2 database under
**`./data`** (gitignored). It is environment-specific, may contain sensitive
state, and must **never** be committed or copied between machines.
