import { Agent, Box, BoxApiKey, OpenCodeModel } from "@upstash/box";
import { formatProjectEnvFile, getProjectEnvMap } from "@/lib/project-env";

export const WORKDIR = "/workspace/home/work";
export const DEV_PORT = 5173;

const PREVIEW_PID_FILE = "/tmp/vibeit-preview.pid";

type BootstrapProjectBoxInput = {
  projectId: string;
};

export type BootstrapProgressEvent = {
  step: string;
  message: string;
  kind: "status" | "log";
};

export type BootstrapProjectBoxResult = {
  boxId: string;
  previewUrl: string;
  previewPort: number;
  previewReachable: boolean;
};

export type EnsurePreviewResult = {
  previewUrl: string;
  previewPort: number;
  previewReachable: boolean;
};

function getOpenCodeModel() {
  const configured = process.env.UPSTASH_OPENCODE_MODEL;

  if (configured) {
    return configured;
  }

  return OpenCodeModel.Zen_MiniMax_M2_5_Free;
}

type ProgressCallback = (event: BootstrapProgressEvent) => void;

const PREVIEW_HEALTHCHECK_COMMAND = `node -e "fetch('http://127.0.0.1:${DEV_PORT}').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"`;

const PREVIEW_START_COMMAND = `cd ${WORKDIR} && ${PREVIEW_HEALTHCHECK_COMMAND} || (if [ -f pnpm-lock.yaml ]; then PM='corepack pnpm'; else PM='npm'; fi; if node -e "const pkg=require('./package.json'); process.exit(typeof pkg.scripts?.dev === 'string' && pkg.scripts.dev.includes('next dev') ? 0 : 1)"; then FLAGS='-- --hostname 0.0.0.0 --port ${DEV_PORT}'; else FLAGS='-- --host 0.0.0.0 --port ${DEV_PORT} --strictPort'; fi; nohup sh -lc "$PM run dev $FLAGS" > /tmp/vite.log 2>&1 & echo $! > ${PREVIEW_PID_FILE})`;

const PREVIEW_WAIT_COMMAND = `for i in $(seq 1 60); do ${PREVIEW_HEALTHCHECK_COMMAND} && exit 0; sleep 1; done; cat /tmp/vite.log; exit 1`;

async function streamExecCommand(
  box: Box,
  command: string,
  step: string,
  statusMessage: string,
  onProgress?: ProgressCallback,
) {
  onProgress?.({
    step,
    message: statusMessage,
    kind: "status",
  });

  const stream = await box.exec.stream(command);
  let exitCode = 0;

  for await (const chunk of stream) {
    if (chunk.type === "output") {
      const message = chunk.data.replace(/\r/g, "");
      if (message.trim().length > 0) {
        onProgress?.({
          step,
          message,
          kind: "log",
        });
      }
      continue;
    }

    if (chunk.type === "exit") {
      exitCode = chunk.exitCode;
    }
  }

  if (exitCode !== 0) {
    throw new Error(`${step} failed with exit code ${exitCode}`);
  }
}

async function runExecCommand(
  box: Box,
  command: string,
  step: string,
  statusMessage: string,
  onProgress?: ProgressCallback,
) {
  onProgress?.({
    step,
    message: statusMessage,
    kind: "status",
  });

  const run = await box.exec.command(command);
  const output = run.result.replace(/\r/g, "").trim();

  if (output.length > 0) {
    onProgress?.({
      step,
      message: output,
      kind: "log",
    });
  }

  if (run.status !== "completed") {
    throw new Error(output || `${step} failed`);
  }
}

async function runWorkspaceBootstrapCommands(box: Box, onProgress?: ProgressCallback) {
  await streamExecCommand(box, `mkdir -p ${WORKDIR}`, "prepare.workspace", "Preparing workspace...", onProgress);
  await box.cd(WORKDIR);

  await streamExecCommand(
    box,
    `cd ${WORKDIR} && if [ -d work ] && [ -f work/package.json ] && [ ! -f package.json ]; then cp -R work/. .; fi`,
    "prepare.workspace",
    "Restoring workspace files...",
    onProgress,
  );

  await streamExecCommand(
    box,
    `cd ${WORKDIR} && if [ ! -f package.json ]; then npm create vite@latest . -- --template react-ts; fi`,
    "create.vite",
    "Creating Vite project...",
    onProgress,
  );

  await streamExecCommand(
    box,
    `cd ${WORKDIR} && if [ -f pnpm-lock.yaml ]; then corepack pnpm install --frozen-lockfile || corepack pnpm install; else npm install --no-fund --no-audit; fi`,
    "install.dependencies",
    "Installing dependencies...",
    onProgress,
  );
}

async function writeProjectEnvFile(box: Box, envMap: Record<string, string>) {
  await box.cd(WORKDIR);

  const entries = Object.entries(envMap)
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => a.key.localeCompare(b.key));

  if (entries.length === 0) {
    await box.exec.command(`cd ${WORKDIR} && rm -f .env.local`);
    return;
  }

  await box.files.write({
    path: ".env.local",
    content: formatProjectEnvFile(entries),
  });
}

async function stopPreviewServer(box: Box, onProgress?: ProgressCallback) {
  await runExecCommand(
    box,
    `cd ${WORKDIR} && PID="$(cat ${PREVIEW_PID_FILE} 2>/dev/null || true)"; case "$PID" in ''|*[!0-9]*) ;; *) kill "$PID" 2>/dev/null || true; sleep 1; kill -9 "$PID" 2>/dev/null || true ;; esac; rm -f /tmp/vite.log ${PREVIEW_PID_FILE}`,
    "stop.devserver",
    "Restarting preview server...",
    onProgress,
  );
}

async function startPreviewServer(box: Box, onProgress?: ProgressCallback) {
  await runExecCommand(
    box,
    PREVIEW_START_COMMAND,
    "start.devserver",
    "Starting preview server...",
    onProgress,
  );

  await runExecCommand(
    box,
    PREVIEW_WAIT_COMMAND,
    "wait.preview",
    "Waiting for preview URL...",
    onProgress,
  );
}

async function waitForPreviewReachable(previewUrl: string) {
  for (let index = 0; index < 30; index += 1) {
    try {
      const response = await fetch(previewUrl, {
        cache: "no-store",
        redirect: "manual",
      });

      if (response.status < 500) {
        return true;
      }
    } catch {
      // keep retrying
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return false;
}

type BootstrapOptions = {
  beforeBootstrap?: (box: Box) => Promise<void>;
  onProgress?: ProgressCallback;
  skipPreviewStartup?: boolean;
};

export async function ensureProjectPreview(
  box: Box,
  onProgress?: ProgressCallback,
): Promise<EnsurePreviewResult> {
  await box.cd(WORKDIR);
  await startPreviewServer(box, onProgress);

  const preview = await box.getPreviewUrl(DEV_PORT);
  const isReachable = await waitForPreviewReachable(preview.url);

  return {
    previewUrl: preview.url,
    previewPort: DEV_PORT,
    previewReachable: isReachable,
  };
}

export async function isProjectPreviewHealthy(box: Box): Promise<boolean> {
  await box.cd(WORKDIR);
  const run = await box.exec.command(PREVIEW_HEALTHCHECK_COMMAND);

  return run.status === "completed";
}

export async function applyProjectEnvVarsToBox(box: Box, projectId: string) {
  const envMap = await getProjectEnvMap(projectId);
  await writeProjectEnvFile(box, envMap);
  return envMap;
}

export async function restartProjectPreview(
  box: Box,
  projectId: string,
  onProgress?: ProgressCallback,
): Promise<EnsurePreviewResult> {
  onProgress?.({
    step: "prepare.env",
    message: "Applying environment variables...",
    kind: "status",
  });

  await applyProjectEnvVarsToBox(box, projectId);
  await stopPreviewServer(box, onProgress);

  return ensureProjectPreview(box, onProgress);
}

export async function isBoxReachable(box: Box): Promise<boolean> {
  const run = await box.exec.command("true");
  return run.status === "completed";
}

export async function bootstrapProjectBox(
  { projectId }: BootstrapProjectBoxInput,
  options?: BootstrapOptions,
): Promise<BootstrapProjectBoxResult> {
  const projectEnv = await getProjectEnvMap(projectId);
  const box = await Box.create({
    runtime: "node",
    env: {
      ...projectEnv,
      VIBEIT_PROJECT_ID: projectId,
    },
    agent: {
      provider: Agent.OpenCode,
      model: getOpenCodeModel(),
      apiKey: BoxApiKey.UpstashKey,
    },
  });

  if (options?.beforeBootstrap) {
    await options.beforeBootstrap(box);
  }

  await runWorkspaceBootstrapCommands(box, options?.onProgress);
  await writeProjectEnvFile(box, projectEnv);

  if (options?.skipPreviewStartup) {
    return {
      boxId: box.id,
      previewUrl: "",
      previewPort: DEV_PORT,
      previewReachable: false,
    };
  }

  const preview = await ensureProjectPreview(box, options?.onProgress);

  return {
    boxId: box.id,
    previewUrl: preview.previewUrl,
    previewPort: preview.previewPort,
    previewReachable: preview.previewReachable,
  };
}

export async function getBoxById(boxId: string) {
  return Box.get(boxId);
}

export async function deleteBoxById(boxId: string) {
  const box = await Box.get(boxId);
  await box.delete();
}
