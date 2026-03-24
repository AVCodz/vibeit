import { query } from "@/db";

type ProjectFileMetadata = {
  path: string;
  sizeBytes: number;
  checksum: string;
};

export async function syncProjectFilesMetadata(params: {
  projectId: string;
  files: ProjectFileMetadata[];
}) {
  const { projectId, files } = params;
  const now = new Date();

  if (files.length > 0) {
    const values: Array<string | number | Date> = [];
    const placeholders: string[] = [];

    files.forEach((file, index) => {
      const base = index * 7;
      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`,
      );
      values.push(projectId, file.path, file.sizeBytes, file.checksum, now, now, now);
    });

    await query(
      `insert into project_files (project_id, path, size_bytes, checksum, last_synced_at, created_at, updated_at) values ${placeholders.join(", ")} on conflict (project_id, path) do update set size_bytes = excluded.size_bytes, checksum = excluded.checksum, last_synced_at = excluded.last_synced_at, updated_at = excluded.updated_at`,
      values,
    );

    await query(
      "delete from project_files where project_id = $1 and path <> all($2::text[])",
      [projectId, files.map((file) => file.path)],
    );
    return;
  }

  await query("delete from project_files where project_id = $1", [projectId]);
}
