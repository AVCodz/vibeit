import { db } from "@/db";
import { projectEnvVars } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PROJECT_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type ProjectEnvInput = {
  key: string;
  value: string;
};

export type ProjectEnvEntry = ProjectEnvInput;

type EncryptedProjectEnvValue = {
  encryptedValue: string;
  iv: string;
  authTag: string;
};

function getProjectEnvEncryptionKey() {
  const configured = process.env.ENV_ENCRYPTION_KEY;

  if (!configured) {
    throw new Error("ENV_ENCRYPTION_KEY is not set");
  }

  return createHash("sha256").update(configured).digest();
}

function encryptProjectEnvValue(value: string): EncryptedProjectEnvValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getProjectEnvEncryptionKey(), iv);
  const encryptedValue = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]).toString("base64");

  return {
    encryptedValue,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptProjectEnvValue(value: EncryptedProjectEnvValue) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getProjectEnvEncryptionKey(),
    Buffer.from(value.iv, "base64"),
  );

  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(value.encryptedValue, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function assertValidProjectEnvKey(key: string) {
  if (!PROJECT_ENV_KEY_PATTERN.test(key)) {
    throw new Error(`Invalid environment variable key: ${key}`);
  }
}

export function normalizeProjectEnvEntries(entries: ProjectEnvInput[]): ProjectEnvEntry[] {
  const normalizedEntries = new Map<string, string>();

  for (const entry of entries) {
    const key = entry.key.trim();
    const value = entry.value;

    if (!key) {
      if (!value.trim()) {
        continue;
      }

      throw new Error("Environment variable key is required");
    }

    assertValidProjectEnvKey(key);
    normalizedEntries.set(key, value);
  }

  return [...normalizedEntries.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export async function listProjectEnvVars(projectId: string): Promise<ProjectEnvEntry[]> {
  const rows = await db
    .select({
      key: projectEnvVars.key,
      encryptedValue: projectEnvVars.encryptedValue,
      iv: projectEnvVars.iv,
      authTag: projectEnvVars.authTag,
    })
    .from(projectEnvVars)
    .where(eq(projectEnvVars.projectId, projectId))
    .orderBy(asc(projectEnvVars.key));

  return rows.map((row) => ({
    key: row.key,
    value: decryptProjectEnvValue({
      encryptedValue: row.encryptedValue,
      iv: row.iv,
      authTag: row.authTag,
    }),
  }));
}

export async function saveProjectEnvVars(projectId: string, entries: ProjectEnvInput[]) {
  const normalizedEntries = normalizeProjectEnvEntries(entries);

  await db.transaction(async (tx) => {
    await tx.delete(projectEnvVars).where(eq(projectEnvVars.projectId, projectId));

    if (normalizedEntries.length === 0) {
      return;
    }

    await tx.insert(projectEnvVars).values(
      normalizedEntries.map((entry) => {
        const encrypted = encryptProjectEnvValue(entry.value);

        return {
          projectId,
          key: entry.key,
          encryptedValue: encrypted.encryptedValue,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
        };
      }),
    );
  });

  return normalizedEntries;
}

export async function getProjectEnvMap(projectId: string) {
  const entries = await listProjectEnvVars(projectId);
  return Object.fromEntries(entries.map((entry) => [entry.key, entry.value]));
}

function serializeProjectEnvValue(value: string) {
  if (/^[^\s"'`$\\\n\r]+$/.test(value)) {
    return value;
  }

  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")}"`;
}

export function formatProjectEnvFile(entries: ProjectEnvEntry[]) {
  if (entries.length === 0) {
    return "";
  }

  return `${entries.map((entry) => `${entry.key}=${serializeProjectEnvValue(entry.value)}`).join("\n")}\n`;
}