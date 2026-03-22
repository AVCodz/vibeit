import { Agent, Box, BoxApiKey, OpenCodeModel } from "@upstash/box";

export const WORKDIR = "/workspace/home/work";
export const DEV_PORT = 5173;

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
    `cd ${WORKDIR} && npm install --no-fund --no-audit`,
    "install.dependencies",
    "Installing dependencies...",
    onProgress,
  );
}

async function startPreviewServer(box: Box, onProgress?: ProgressCallback) {
  await runExecCommand(
    box,
    `cd ${WORKDIR} && node -e "fetch('http://127.0.0.1:${DEV_PORT}').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" || nohup npm run dev -- --host 0.0.0.0 --port ${DEV_PORT} --strictPort > /tmp/vite.log 2>&1 &`,
    "start.devserver",
    "Starting preview server...",
    onProgress,
  );

  await runExecCommand(
    box,
    `for i in $(seq 1 60); do node -e "fetch('http://127.0.0.1:${DEV_PORT}').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" && exit 0; sleep 1; done; cat /tmp/vite.log; exit 1`,
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
  const run = await box.exec.command(
    `node -e "fetch('http://127.0.0.1:${DEV_PORT}').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"`,
  );

  return run.status === "completed";
}

export async function bootstrapProjectBox(
  { projectId }: BootstrapProjectBoxInput,
  options?: BootstrapOptions,
): Promise<BootstrapProjectBoxResult> {
  const box = await Box.create({
    runtime: "node",
    env: {
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
