import { Agent, Box, BoxApiKey, OpenCodeModel } from "@upstash/box";

export const WORKDIR = "/workspace/home/work";
export const DEV_PORT = 5173;

type BootstrapProjectBoxInput = {
  projectId: string;
};

export type BootstrapProjectBoxResult = {
  boxId: string;
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

async function runBootstrapCommands(box: Box) {
  await box.exec.command(`mkdir -p ${WORKDIR}`);
  await box.cd(WORKDIR);

  await box.exec.command(
    `cd ${WORKDIR} && if [ -d work ] && [ -f work/package.json ] && [ ! -f package.json ]; then cp -R work/. .; fi`,
  );

  await box.exec.command(`cd ${WORKDIR} && if [ ! -f package.json ]; then npm create vite@latest . -- --template react-ts; fi`);
  await box.exec.command(`cd ${WORKDIR} && npm install --no-fund --no-audit`);

  await box.exec.command(
    `cd ${WORKDIR} && if ! pgrep -f "vite.*${DEV_PORT}" > /dev/null; then nohup npm run dev -- --host 0.0.0.0 --port ${DEV_PORT} --strictPort > /tmp/vite.log 2>&1 & fi`,
  );

  await box.exec.command(
    `for i in $(seq 1 60); do node -e "fetch('http://127.0.0.1:${DEV_PORT}').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" && exit 0; sleep 1; done; cat /tmp/vite.log; exit 1`,
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
};

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

  await runBootstrapCommands(box);

  const preview = await box.getPreviewUrl(DEV_PORT);
  const isReachable = await waitForPreviewReachable(preview.url);

  return {
    boxId: box.id,
    previewUrl: preview.url,
    previewPort: DEV_PORT,
    previewReachable: isReachable,
  };
}

export async function getBoxById(boxId: string) {
  return Box.get(boxId);
}

export async function deleteBoxById(boxId: string) {
  const box = await Box.get(boxId);
  await box.delete();
}
