#!/usr/bin/env node
/**
 * TideCloak local-dev control wrapper (LOCAL DEVELOPMENT ONLY).
 *
 * Thin, safe front-end for `docker compose -f docker-compose.tidecloak.yml`.
 * This is the ONLY Docker in the repo — the frontend, backend and Firestore
 * are not containerised. Docker here hosts a local TideCloak identity server
 * for the SOC Incident Report Protection PoC.
 *
 *   node scripts/tidecloak.js start     # start (validates .env first)
 *   node scripts/tidecloak.js stop      # stop, KEEP the ./data volume
 *   node scripts/tidecloak.js status    # container state + HTTP probe
 *   node scripts/tidecloak.js logs      # follow container logs
 *
 * Run via pnpm:  pnpm run tidecloak:start | tidecloak:stop | tidecloak:status | tidecloak:logs
 *
 * Safety:
 *  - `start` refuses to run unless BOTH KC_BOOTSTRAP_ADMIN_USERNAME and
 *    KC_BOOTSTRAP_ADMIN_PASSWORD are set in the root .env. There is no default
 *    username and no default password (a default credential is a hard-coded
 *    credential with extra steps — Tide playbook `start-tidecloak-dev`, AP-41).
 *  - Credentials are passed to Docker via the environment only; they are never
 *    printed, logged, or written to disk by this script.
 *  - No destructive Docker verbs. `stop` uses `compose stop` (not `down -v`);
 *    there is deliberately no `reset`/`wipe` command here. No `--restart` flag:
 *    the container never auto-starts with Docker.
 *  - Every action goes through `docker compose -f <this file> <verb>` and targets
 *    the Compose SERVICE `tidecloak`, scoped to this Compose project. Nothing
 *    here references a global container name, so a pre-existing `tidecloak`
 *    container from another project is never touched.
 *
 * Reference: Tide playbooks `start-tidecloak-dev`, canon `version-policy`.
 */
'use strict'

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const composeFile = path.join(root, 'docker-compose.tidecloak.yml')
const envPath = path.join(root, '.env')

const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const GREEN = '\x1b[32m'
const RESET = '\x1b[0m'

function die(msg) {
  console.error(`${RED}${msg}${RESET}`)
  process.exit(1)
}

/** Minimal .env reader — KEY=VALUE, # comments. Mirrors scripts/sync-env.js. */
function readEnvFile() {
  if (!fs.existsSync(envPath)) {
    die(
      'No .env file at the repo root.\n' +
        'Create it:  cp .env.example .env\n' +
        'Then set KC_BOOTSTRAP_ADMIN_USERNAME and KC_BOOTSTRAP_ADMIN_PASSWORD (local only — never commit).',
    )
  }
  const vars = {}
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    let value = t.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    vars[t.slice(0, eq).trim()] = value
  }
  return vars
}

function requireDocker() {
  const r = spawnSync('docker', ['info'], { stdio: 'ignore' })
  if (r.status !== 0) {
    die('Docker is not available or not running. Start Docker Desktop and retry.')
  }
}

/**
 * Run `docker compose -f <file> <args...>`, inheriting stdio.
 *
 * The compose file marks KC_BOOTSTRAP_ADMIN_* as required (`${VAR:?...}`), which
 * compose evaluates for EVERY subcommand — including `stop`/`ps`/`logs`, where
 * the values are irrelevant. So for non-`up` commands we supply throwaway
 * placeholders purely to satisfy interpolation; `up` always gets the real
 * values from .env via `extraEnv`.
 */
function compose(args, extraEnv) {
  const placeholderEnv = {
    KC_BOOTSTRAP_ADMIN_USERNAME: 'unused-for-this-command',
    KC_BOOTSTRAP_ADMIN_PASSWORD: 'unused-for-this-command',
  }
  const r = spawnSync('docker', ['compose', '-f', composeFile, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: { ...placeholderEnv, ...process.env, ...extraEnv },
  })
  return r.status ?? 1
}

function probeHttp() {
  // Node core only — no deps. Resolves to an HTTP status number or null.
  const http = require('http')
  return new Promise((resolve) => {
    const req = http.get('http://localhost:8080', (res) => {
      res.resume()
      resolve(res.statusCode ?? null)
    })
    req.setTimeout(3000, () => {
      req.destroy()
      resolve(null)
    })
    req.on('error', () => resolve(null))
  })
}

async function main() {
  const cmd = process.argv[2]

  if (!['start', 'stop', 'status', 'logs'].includes(cmd)) {
    die('Usage: node scripts/tidecloak.js <start|stop|status|logs>')
  }

  requireDocker()

  if (cmd === 'start') {
    const env = readEnvFile()
    const user = env.KC_BOOTSTRAP_ADMIN_USERNAME
    const pass = env.KC_BOOTSTRAP_ADMIN_PASSWORD

    const blank = (v) => !v || v.trim() === ''
    const missing = [
      blank(user) && 'KC_BOOTSTRAP_ADMIN_USERNAME',
      blank(pass) && 'KC_BOOTSTRAP_ADMIN_PASSWORD',
    ].filter(Boolean)

    if (missing.length > 0) {
      die(
        `${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} empty in .env.\n` +
          'Set both in your local .env — they are gitignored and never leave your machine.\n' +
          'There is no default username and no default password: refusing to start TideCloak\n' +
          'without explicit local credentials.',
      )
    }

    console.log(`${YELLOW}Starting TideCloak (local dev)…${RESET}`)
    console.log('  image:  tideorg/tidecloak-dev:latest')
    console.log('  url:    http://localhost:8080')
    console.log('  admin:  (username and password from .env — not shown)')
    console.log('  data:   ./data  (H2 database bind mount)\n')

    const code = compose(['up', '-d', 'tidecloak'], {
      KC_BOOTSTRAP_ADMIN_USERNAME: user,
      KC_BOOTSTRAP_ADMIN_PASSWORD: pass,
    })
    if (code !== 0) process.exit(code)

    console.log(`\n${YELLOW}Waiting for readiness (TideCloak takes ~30–60s)…${RESET}`)
    for (let i = 1; i <= 20; i++) {
      // eslint-disable-next-line no-await-in-loop
      const status = await probeHttp()
      if (status && status < 500) {
        console.log(`${GREEN}TideCloak is up: http://localhost:8080 (HTTP ${status})${RESET}`)
        console.log('\nRealm bootstrap is Phase 1B — see docs/TIDECLOAK-LOCAL.md')
        return
      }
      process.stdout.write(`  attempt ${i}/20…\r`)
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 5000))
    }
    console.warn(
      `\n${YELLOW}Not responding yet. Check: pnpm run tidecloak:logs${RESET}`,
    )
    return
  }

  if (cmd === 'stop') {
    console.log(`${YELLOW}Stopping TideCloak (the ./data volume is kept)…${RESET}`)
    // `compose stop <service>` — NOT `down -v`. Data and realm state survive,
    // and only this project's `tidecloak` service is targeted.
    process.exit(compose(['stop', 'tidecloak']))
  }

  if (cmd === 'logs') {
    process.exit(compose(['logs', '-f', '--tail', '200', 'tidecloak']))
  }

  if (cmd === 'status') {
    compose(['ps'])
    const status = await probeHttp()
    if (status && status < 500) {
      console.log(`${GREEN}HTTP probe: http://localhost:8080 → ${status}${RESET}`)
    } else {
      console.log(`${YELLOW}HTTP probe: http://localhost:8080 → no response${RESET}`)
    }
  }
}

main().catch((err) => die(String(err && err.stack ? err.stack : err)))
