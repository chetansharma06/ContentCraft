import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function loadRootEnv() {
  const envPath = path.join(root, '.env')
  if (!existsSync(envPath)) return

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!match || match[1] in process.env) continue

    let value = match[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    } else {
      value = value.replace(/\s+#.*$/, '')
    }
    process.env[match[1]] = value
  }
}

function configuredPort(name, fallback) {
  const port = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a valid TCP port (1-65535).`)
  }
  return port
}

function urlHost(host) {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

loadRootEnv()

const backendHost = process.env.BACKEND_HOST ?? '127.0.0.1'
const backendPort = configuredPort('BACKEND_PORT', 8000)
const frontendHost = process.env.FRONTEND_HOST ?? '127.0.0.1'
const frontendPort = configuredPort('FRONTEND_PORT', 5173)
const backendUrl = `http://${urlHost(backendHost)}:${backendPort}`
const frontendUrl = `http://${urlHost(frontendHost)}:${frontendPort}`
const startupTimeout = Number(process.env.STARTUP_TIMEOUT_SECONDS ?? 60) * 1000
const pythonPath = process.platform === 'win32'
  ? path.join(root, '.venv', 'Scripts', 'python.exe')
  : path.join(root, '.venv', 'bin', 'python')
const python = existsSync(pythonPath) ? pythonPath : (process.platform === 'win32' ? 'python' : 'python3')
const vitePath = path.join(root, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js')

if (!existsSync(vitePath)) {
  console.error('Frontend dependencies are missing. Run "npm install --prefix frontend" once, then retry.')
  process.exit(1)
}

const childEnv = {
  ...process.env,
  BACKEND_HOST: backendHost,
  BACKEND_PORT: String(backendPort),
  FRONTEND_HOST: frontendHost,
  FRONTEND_PORT: String(frontendPort),
  VITE_API_BASE_URL: process.env.VITE_API_BASE_URL ?? '/api',
  VITE_BACKEND_URL: process.env.VITE_BACKEND_URL ?? backendUrl,
  VITE_HOST: frontendHost,
  VITE_PORT: String(frontendPort),
  CORS_ORIGINS: process.env.CORS_ORIGINS ?? `${frontendUrl},http://localhost:${frontendPort}`,
}

let backend
let frontend
let stopping = false
let shutdownPromise
let backendExit

function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()

  return new Promise((resolve) => {
    const forceKill = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        if (process.platform === 'win32') {
          spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
        } else {
          child.kill('SIGKILL')
        }
      }
      resolve()
    }, 5000)
    forceKill.unref()
    child.once('exit', () => {
      clearTimeout(forceKill)
      resolve()
    })
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      killer.once('error', () => child.kill('SIGKILL'))
    } else {
      child.kill('SIGTERM')
    }
  })
}

function shutdown(exitCode) {
  if (shutdownPromise) return shutdownPromise
  stopping = true
  process.exitCode = exitCode
  shutdownPromise = Promise.all([stopChild(frontend), stopChild(backend)])
  return shutdownPromise
}

process.once('SIGINT', () => void shutdown(0))
process.once('SIGTERM', () => void shutdown(0))

async function backendIsHealthy() {
  try {
    const response = await fetch(`${backendUrl}/health`, { signal: AbortSignal.timeout(1200) })
    return response.ok
  } catch {
    return false
  }
}

try {
  let ready = await backendIsHealthy()
  if (ready) {
    console.log(`Using already healthy backend at ${backendUrl}.`)
  } else {
    backend = spawn(python, ['-m', 'uvicorn', 'app.main:app', '--host', backendHost, '--port', String(backendPort)], {
      cwd: root,
      env: childEnv,
      stdio: 'inherit',
    })
    backendExit = new Promise((resolve) => backend.once('exit', (code, signal) => resolve({ code, signal })))
    backend.once('error', (error) => {
      console.error(`Could not start the backend: ${error.message}`)
      void shutdown(1)
    })
    backend.once('exit', (code, signal) => {
      if (stopping) return
      console.error(`Backend stopped unexpectedly (${signal ?? `exit code ${code}`}).`)
      void shutdown(code && code !== 0 ? code : 1)
    })
    console.log(`Starting backend at ${backendUrl} ...`)
  }

  const deadline = Date.now() + startupTimeout
  while (Date.now() < deadline && !stopping) {
    if (backendExit) {
      const exited = await Promise.race([
        backendExit.then((result) => ({ exited: result })),
        delay(300).then(() => ({ exited: null })),
      ])
      if (exited.exited) {
        throw new Error(`Backend failed to start (exit code ${exited.exited.code ?? exited.exited.signal}).`)
      }
    }
    ready = await backendIsHealthy()
    if (ready) {
      break
    }
    await delay(300)
  }

  if (!stopping) {
    if (!ready) throw new Error(`Backend did not become healthy within ${startupTimeout / 1000} seconds.`)

    console.log(`Backend is ready. Starting frontend at ${frontendUrl} ...`)
    frontend = spawn(process.execPath, [vitePath, '--host', frontendHost, '--port', String(frontendPort), '--strictPort'], {
      cwd: path.join(root, 'frontend'),
      env: childEnv,
      stdio: 'inherit',
    })
    frontend.once('error', (error) => {
      console.error(`Could not start the frontend: ${error.message}`)
      void shutdown(1)
    })
    frontend.once('exit', (code, signal) => {
      if (stopping) return
      if (code && code !== 0) console.error(`Frontend stopped unexpectedly (${signal ?? `exit code ${code}`}).`)
      void shutdown(code ?? 1)
    })
  }
} catch (error) {
  console.error(`ContentCraft startup failed: ${error.message}`)
  await shutdown(1)
}