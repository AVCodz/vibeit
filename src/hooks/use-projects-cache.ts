"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type CachedProject = {
  id: string;
  name: string;
  description: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
};

type ProjectsCache = {
  projects: CachedProject[];
  updatedAt: number;
};

const STORAGE_KEY = "vibeit:projects-cache";

function readCache(): CachedProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ProjectsCache;
    return parsed.projects;
  } catch {
    return [];
  }
}

function writeCache(projects: CachedProject[]) {
  try {
    const payload: ProjectsCache = { projects, updatedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // storage full or unavailable
  }
}

type ApiProject = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  thumbnailUrl: string | null;
  lastOpenedAt: string | null;
  updatedAt: string;
  createdAt: string;
};

function toCached(p: ApiProject): CachedProject {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    thumbnailUrl: p.thumbnailUrl,
    createdAt: p.createdAt,
  };
}

export function useProjectsCache() {
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const hasFetched = useRef(false);

  // Hydrate from cache on mount
  useEffect(() => {
    const cached = readCache();
    if (cached.length > 0) {
      setProjects(
        cached.map((c) => ({
          ...c,
          status: "",
          lastOpenedAt: null,
          updatedAt: c.createdAt,
        })),
      );
      setIsLoading(false);
    }
  }, []);

  const fetchAndSync = useCallback(async () => {
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      const data = (await response.json()) as {
        projects?: ApiProject[];
        error?: string;
      };

      if (!response.ok || !data.projects) {
        throw new Error(data.error ?? "Failed to load projects");
      }

      setProjects(data.projects);
      writeCache(data.projects.map(toCached));
      setError("");
    } catch (err) {
      if (!hasFetched.current) {
        setError(err instanceof Error ? err.message : "Failed to load projects");
      }
    } finally {
      hasFetched.current = true;
      setIsLoading(false);
    }
  }, []);

  const renameProject = useCallback((id: string, newName: string) => {
    setProjects((prev) => {
      const updated = prev.map((p) => (p.id === id ? { ...p, name: newName } : p));
      writeCache(updated.map(toCached));
      return updated;
    });
  }, []);

  const removeProject = useCallback((id: string) => {
    setProjects((prev) => {
      const updated = prev.filter((p) => p.id !== id);
      writeCache(updated.map(toCached));
      return updated;
    });
  }, []);

  return { projects, isLoading, error, fetchAndSync, renameProject, removeProject };
}

