import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Box } from "@upstash/box";
import { createHash } from "node:crypto";

const WORKDIR = "/workspace/home/work";
const WORKSPACE_PREFIX = "workspace";

function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId) {
    throw new Error("R2_ACCOUNT_ID is not set");
  }

  if (!accessKeyId) {
    throw new Error("R2_ACCESS_KEY_ID is not set");
  }

  if (!secretAccessKey) {
    throw new Error("R2_SECRET_ACCESS_KEY is not set");
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

function getBucketName() {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) {
    throw new Error("R2_BUCKET is not set");
  }

  return bucket;
}

function normalizePath(path: string) {
  return path.replace(/^\/+/, "");
}

function isIgnoredPath(path: string) {
  const normalized = normalizePath(path);
  const parts = normalized.split("/");
  const fileName = parts[parts.length - 1] ?? "";

  return (
    fileName.startsWith(".env") ||
    normalized === "node_modules" ||
    normalized.startsWith("node_modules/") ||
    normalized.includes("/node_modules/") ||
    normalized === ".git" ||
    normalized.startsWith(".git/") ||
    normalized.includes("/.git/") ||
    normalized === "dist" ||
    normalized.startsWith("dist/") ||
    normalized.includes("/dist/") ||
    normalized === "build" ||
    normalized.startsWith("build/") ||
    normalized.includes("/build/")
  );
}

async function listBoxFilesRecursive(box: Box, path = ""): Promise<string[]> {
  const entries = await box.files.list(path || undefined);
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path ? `${path}/${entry.name}` : entry.name;
    const normalizedEntryPath = normalizePath(entryPath);

    if (isIgnoredPath(normalizedEntryPath)) {
      continue;
    }

    if (entry.is_dir) {
      const nested = await listBoxFilesRecursive(box, normalizedEntryPath);
      files.push(...nested);
      continue;
    }

    files.push(normalizedEntryPath);
  }

  return files;
}

function createChecksum(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

type SyncedFile = {
  path: string;
  sizeBytes: number;
  checksum: string;
};

async function listR2Keys(prefix: string) {
  const client = getR2Client();
  const bucket = getBucketName();

  let continuationToken: string | undefined;
  const keys: string[] = [];

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const object of response.Contents ?? []) {
      if (object.Key) {
        keys.push(object.Key);
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

function toWorkspaceKey(r2Prefix: string, filePath: string) {
  return `${r2Prefix}/${WORKSPACE_PREFIX}/${normalizePath(filePath)}`;
}

function fromWorkspaceKey(r2Prefix: string, key: string) {
  const start = `${r2Prefix}/${WORKSPACE_PREFIX}/`;
  return key.startsWith(start) ? key.slice(start.length) : key;
}

export async function syncProjectWorkspaceToR2(params: { box: Box; r2Prefix: string }) {
  const { box, r2Prefix } = params;
  const client = getR2Client();
  const bucket = getBucketName();

  await box.cd(WORKDIR);
  const filePaths = await listBoxFilesRecursive(box);
  const uploadedKeys = new Set<string>();
  const syncedFiles: SyncedFile[] = [];

  for (const filePath of filePaths) {
    const content = await box.files.read(filePath);
    const key = toWorkspaceKey(r2Prefix, filePath);
    const sizeBytes = Buffer.byteLength(content, "utf8");
    const checksum = createChecksum(content);

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: content,
        ContentType: "text/plain; charset=utf-8",
      }),
    );

    uploadedKeys.add(key);
    syncedFiles.push({
      path: filePath,
      sizeBytes,
      checksum,
    });
  }

  const existingKeys = await listR2Keys(`${r2Prefix}/${WORKSPACE_PREFIX}/`);
  const stale = existingKeys.filter((key) => !uploadedKeys.has(key));

  if (stale.length > 0) {
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: stale.map((key) => ({ Key: key })),
          Quiet: true,
        },
      }),
    );
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `${r2Prefix}/manifest.json`,
      Body: JSON.stringify({
        syncedAt: new Date().toISOString(),
        fileCount: filePaths.length,
        files: syncedFiles.map((file) => ({
          path: file.path,
          sizeBytes: file.sizeBytes,
          checksum: file.checksum,
        })),
      }),
      ContentType: "application/json",
    }),
  );

  return {
    fileCount: filePaths.length,
    files: syncedFiles,
  };
}

export async function restoreProjectWorkspaceFromR2(params: { box: Box; r2Prefix: string }) {
  const { box, r2Prefix } = params;
  const client = getR2Client();
  const bucket = getBucketName();

  const keys = await listR2Keys(`${r2Prefix}/${WORKSPACE_PREFIX}/`);
  if (keys.length === 0) {
    return { restored: 0 };
  }

  await box.exec.command(`mkdir -p ${WORKDIR}`);
  await box.cd(WORKDIR);

  let restored = 0;

  for (const key of keys) {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );

    const body = response.Body;
    if (!body) {
      continue;
    }

    const content = await body.transformToString();
    const targetPath = fromWorkspaceKey(r2Prefix, key);

    await box.files.write({
      path: targetPath,
      content,
    });

    restored += 1;
  }

  return { restored };
}

const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
]);

const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024; // 5MB (Fireworks AI URL limit)

export function isAllowedImageType(contentType: string) {
  return ALLOWED_IMAGE_TYPES.has(contentType.toLowerCase());
}

export function isWithinAttachmentSizeLimit(sizeBytes: number) {
  return sizeBytes <= MAX_ATTACHMENT_SIZE;
}

export async function uploadMessageAttachment(params: {
  r2Prefix: string;
  attachmentId: string;
  filename: string;
  bytes: Uint8Array;
  contentType: string;
}) {
  const { r2Prefix, attachmentId, filename, bytes, contentType } = params;
  const client = getR2Client();
  const bucket = getBucketName();

  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `${r2Prefix}/attachments/${attachmentId}/${sanitizedFilename}`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }),
  );

  const publicBase = process.env.R2_PUBLIC_BASE_URL;
  const publicUrl = publicBase
    ? `${publicBase.replace(/\/$/, "")}/${key}`
    : key;

  return { key, publicUrl };
}

export async function uploadProjectThumbnail(params: {
  r2Prefix: string;
  bytes: Uint8Array;
  contentType: string;
}) {
  const { r2Prefix, bytes, contentType } = params;
  const client = getR2Client();
  const bucket = getBucketName();
  const key = `${r2Prefix}/thumbnail/latest.webp`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }),
  );

  const publicBase = process.env.R2_PUBLIC_BASE_URL;
  if (publicBase) {
    return `${publicBase.replace(/\/$/, "")}/${key}`;
  }

  return key;
}

export async function deleteAllProjectR2Objects(r2Prefix: string): Promise<{ deleted: number }> {
  const client = getR2Client();
  const bucket = getBucketName();
  const keys = await listR2Keys(r2Prefix);

  if (keys.length === 0) {
    return { deleted: 0 };
  }

  const BATCH_SIZE = 1000;
  let deleted = 0;

  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: batch.map((key) => ({ Key: key })),
          Quiet: true,
        },
      }),
    );
    deleted += batch.length;
  }

  return { deleted };
}

export async function capturePreviewThumbnail(previewUrl: string) {
  const accessKey = process.env.SCREENSHOTONE_ACCESS_KEY;

  if (!accessKey) {
    throw new Error("SCREENSHOTONE_ACCESS_KEY is not set");
  }

  const query = new URLSearchParams({
    access_key: accessKey,
    url: previewUrl,
    format: "webp",
    viewport_width: "1280",
    viewport_height: "720",
    image_width: "1280",
    image_height: "720",
    device_scale_factor: "1",
    block_ads: "true",
    block_cookie_banners: "true",
    block_chats: "true",
    timeout: "30",
    cache: "false",
  });

  const response = await fetch(`https://api.screenshotone.com/take?${query.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Unable to capture preview thumbnail: ${response.status} ${errorBody}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const contentType = response.headers.get("content-type") ?? "image/webp";

  return {
    bytes,
    contentType,
  };
}
