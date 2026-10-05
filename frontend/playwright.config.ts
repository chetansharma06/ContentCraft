import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const frontendRoot = process.cwd()
const workspaceRoot = resolve(frontendRoot, '..')
const pythonPath = join(workspaceRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const python = existsSync(pythonPath) ? pythonPath : 'python'
const databasePath = join(tmpdir(), `contentcraft-e2e-${process.pid}.db`).replaceAll('\\', '/')
const databaseUrl = `sqlite:///${databasePath}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'retain-on-failure',
    channel: 'chrome',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: `"${python}" -m uvicorn app.main:app --host 127.0.0.1 --port 8001`,
      cwd: workspaceRoot,
      url: 'http://127.0.0.1:8001/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { ...process.env, LLM_PROVIDER: 'mock', DATABASE_URL: databaseUrl },
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort',
      cwd: frontendRoot,
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { ...process.env, VITE_BACKEND_URL: 'http://127.0.0.1:8001' },
    },
  ],
})