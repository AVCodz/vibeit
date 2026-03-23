"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { HiFolderOpen, HiClock, HiArrowPath } from "react-icons/hi2";

type Project = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  thumbnailUrl: string | null;
  lastOpenedAt: string | null;
  updatedAt: string;
  createdAt: string;
};

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-emerald-500/20 text-emerald-400" },
  inactive: { label: "Inactive", className: "bg-muted text-muted-foreground" },
  closing: { label: "Closing", className: "bg-yellow-500/20 text-yellow-400" },
  error: { label: "Error", className: "bg-destructive/20 text-destructive" },
  archived: { label: "Archived", className: "bg-muted text-muted-foreground" },
};

function formatRelativeTime(dateString: string) {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export default function ProjectsPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isPending) return;

    if (!session?.user) {
      router.push("/auth");
      return;
    }

    async function fetchProjects() {
      try {
        const response = await fetch("/api/projects", { cache: "no-store" });
        const data = (await response.json()) as {
          projects?: Project[];
          error?: string;
        };

        if (!response.ok || !data.projects) {
          throw new Error(data.error ?? "Failed to load projects");
        }

        setProjects(data.projects);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load projects");
      } finally {
        setIsLoading(false);
      }
    }

    void fetchProjects();
  }, [isPending, session, router]);

  if (isPending) return null;

  if (!session?.user) return null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Your Projects
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          All your VibeIt projects in one place.
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-36 animate-pulse rounded-xl border border-border/60 bg-card/60"
            />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-border/60 bg-card/60 p-8 text-center">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card/60 p-12 text-center">
          <HiFolderOpen className="mx-auto mb-3 size-8 text-muted-foreground/60" />
          <p className="text-sm font-medium text-muted-foreground">
            No projects yet
          </p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Head back to the{" "}
            <Link href="/" className="underline hover:text-foreground">
              homepage
            </Link>{" "}
            and describe your first idea.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const statusInfo = STATUS_LABELS[project.status] ?? STATUS_LABELS.inactive;
            const timeLabel = project.lastOpenedAt
              ? `Opened ${formatRelativeTime(project.lastOpenedAt)}`
              : `Updated ${formatRelativeTime(project.updatedAt)}`;

            return (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="group flex flex-col justify-between overflow-hidden rounded-xl border border-border/60 bg-card/60 transition-colors hover:border-border hover:bg-card"
              >
                <div className="aspect-[16/9] w-full overflow-hidden border-b border-border/60 bg-black/30">
                  {project.thumbnailUrl ? (
                    <img
                      src={project.thumbnailUrl}
                      alt={`${project.name} thumbnail`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground/70">
                      No thumbnail yet
                    </div>
                  )}
                </div>

                <div className="flex flex-1 flex-col justify-between p-5">
                  <div>
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <h2 className="truncate text-sm font-semibold text-foreground group-hover:text-foreground">
                        {project.name}
                      </h2>
                      <span
                        className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium ${statusInfo.className}`}
                      >
                        {statusInfo.label}
                      </span>
                    </div>
                    {project.description ? (
                      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {project.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                    {project.lastOpenedAt ? (
                      <HiClock className="size-3" />
                    ) : (
                      <HiArrowPath className="size-3" />
                    )}
                    {timeLabel}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
