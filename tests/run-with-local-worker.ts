#!/usr/bin/env bun
import { spawn, spawnSync } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const commandArgs = process.argv.slice(2);

if (commandArgs.length === 0) {
  console.error(
    `Usage: ${path.basename(process.argv[1] ?? 'run-with-local-worker.ts')} <command> [args...]`
  );
  process.exit(1);
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = `${Date.now()}-${process.pid}`;
const artifactsDir = resolvePath(
  process.env.UHUB_ARTIFACTS_DIR,
  path.join(rootDir, 'artifacts/local-worker')
);
const hasExplicitWorkerPort = Boolean(process.env.UHUB_WORKER_PORT);
const workerPort = await resolveWorkerPort(process.env.UHUB_WORKER_PORT);
const workerBaseUrl = `http://127.0.0.1:${workerPort}`;
const persistDir = process.env.UHUB_PERSIST_TO
  ? resolvePath(process.env.UHUB_PERSIST_TO, rootDir)
  : mkdtempSync(path.join(tmpdir(), 'uhub-worker-state.'));
const workerPidFile = path.join(artifactsDir, `worker-${runId}.pid`);
const workerLogFile = path.join(artifactsDir, `worker-${runId}.log`);
const dbMigrateLogFile = path.join(artifactsDir, `db-migrate-${runId}.log`);
const sharedEnv = {
  ...process.env,
  UHUB_ARTIFACTS_DIR: artifactsDir,
  UHUB_PERSIST_TO: persistDir,
  UHUB_WORKER_BASE_URL: workerBaseUrl,
  UHUB_ADMIN_EMAIL: process.env.UHUB_ADMIN_EMAIL ?? 'ci-admin@example.com',
  UHUB_ADMIN_PASSWORD: process.env.UHUB_ADMIN_PASSWORD ?? 'ci-admin-password-123',
};

let workerProcess: ReturnType<typeof spawn> | null = null;
let cleaningUp = false;

mkdirSync(artifactsDir, { recursive: true });

process.on('SIGINT', () => {
  void exitWithCleanup(130);
});
process.on('SIGTERM', () => {
  void exitWithCleanup(143);
});

await main();

async function main() {
  try {
    if (hasExplicitWorkerPort) {
      await killWorkerPortListeners();
    }

    runLoggedCommand(
      'bun',
      [
        'x',
        'wrangler',
        'd1',
        'migrations',
        'apply',
        'DB',
        '--local',
        '--persist-to',
        persistDir,
        '--cwd',
        'apps/api-worker',
      ],
      dbMigrateLogFile,
      'Database migrations'
    );

    startWorker();
    await waitForWorkerHealth();

    const exitCode = await runTargetCommand();
    await exitWithCleanup(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    await exitWithCleanup(1);
  }
}

function resolvePath(input: string | undefined, fallback: string) {
  if (!input) {
    return fallback;
  }

  return path.isAbsolute(input) ? input : path.resolve(rootDir, input);
}

async function resolveWorkerPort(value: string | undefined) {
  if (!value) {
    return await findAvailablePort();
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid UHUB_WORKER_PORT: ${value}`);
  }

  return parsed;
}

async function findAvailablePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate worker port'));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

function runLoggedCommand(command: string, args: string[], logFile: string, label: string) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: sharedEnv,
    encoding: 'utf8',
  });

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  writeFileSync(logFile, `${stdout}${stderr}`);

  if (stdout) {
    process.stdout.write(stdout);
  }

  if (stderr) {
    process.stderr.write(stderr);
  }

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}. See ${logFile}`);
  }
}

function startWorker() {
  const logStream = createWriteStream(workerLogFile, { flags: 'w' });
  workerProcess = spawn(
    'bun',
    [
      'run',
      '--cwd',
      'apps/api-worker',
      'dev',
      '--',
      '--config',
      'wrangler.jsonc',
      '--port',
      String(workerPort),
      '--persist-to',
      persistDir,
      '--var',
      `ADMIN_EMAIL:${sharedEnv.UHUB_ADMIN_EMAIL}`,
      '--var',
      `ADMIN_PASSWORD:${sharedEnv.UHUB_ADMIN_PASSWORD}`,
      '--var',
      'GATEWAY_TIMEOUT_MS:1000',
      '--var',
      'GATEWAY_CHANNEL_UNHEALTHY_COOLDOWN_MS:1000',
    ],
    {
      cwd: rootDir,
      env: sharedEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  if (!workerProcess.pid) {
    throw new Error(`Failed to start worker. See ${workerLogFile}`);
  }

  writeFileSync(workerPidFile, String(workerProcess.pid));
  workerProcess.stdout?.pipe(logStream);
  workerProcess.stderr?.pipe(logStream);
}

async function waitForWorkerHealth() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${workerBaseUrl}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {}

    if (workerProcess?.exitCode !== null) {
      throw new Error(`Worker exited before becoming healthy. See ${workerLogFile}`);
    }

    await sleep(1_000);
  }

  throw new Error(
    `Worker did not become healthy at ${workerBaseUrl} within 30s. See ${workerLogFile}`
  );
}

async function runTargetCommand() {
  const [command, ...args] = commandArgs;

  if (!command) {
    throw new Error('Target command is required');
  }

  return await new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: sharedEnv,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }

      resolve(code ?? 1);
    });
  });
}

async function killWorkerPortListeners() {
  const listeners = getWorkerPortListeners();

  for (const pid of listeners) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}
  }

  if (listeners.length > 0) {
    await sleep(1_000);
  }
}

function getWorkerPortListeners() {
  const result = spawnSync(
    'bash',
    [
      '-lc',
      `ss -ltnp | grep ":${workerPort} " | sed -n 's/.*pid=\\([0-9]\\+\\).*/\\1/p' | sort -u`,
    ],
    {
      cwd: rootDir,
      env: sharedEnv,
      encoding: 'utf8',
    }
  );

  if (result.error) {
    return [];
  }

  return (result.stdout ?? '')
    .split('\n')
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value));
}

async function exitWithCleanup(code: number) {
  if (cleaningUp) {
    process.exit(code);
  }

  cleaningUp = true;

  if (existsSync(workerPidFile)) {
    try {
      const workerPid = Number.parseInt(Bun.file(workerPidFile).textSync(), 10);
      if (Number.isInteger(workerPid)) {
        process.kill(workerPid, 'SIGTERM');
      }
    } catch {}

    rmSync(workerPidFile, { force: true });
  }

  if (hasExplicitWorkerPort) {
    await killWorkerPortListeners();
  }

  if (!process.env.UHUB_PERSIST_TO) {
    rmSync(persistDir, { force: true, recursive: true });
  }

  process.exit(code);
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
