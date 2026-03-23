"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { HiFolderOpen, HiClock } from "react-icons/hi2";
import { HiEllipsisVertical, HiPencil, HiTrash } from "react-icons/hi2";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

function formatCreatedAt(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ProjectsPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renaming, setRenaming] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  async function handleRename() {
    if (!renameTarget || !renameName.trim()) return;
    setRenaming(true);
    try {
      const res = await fetch(`/api/projects/${renameTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameName.trim() }),
      });
      if (res.ok) {
        setProjects((prev) =>
          prev.map((p) =>
            p.id === renameTarget.id ? { ...p, name: renameName.trim() } : p,
          ),
        );
      }
    } finally {
      setRenaming(false);
      setRenameTarget(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      }
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

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
              className="animate-pulse overflow-hidden rounded-xl border border-border/60 bg-card/60"
            >
              <div className="aspect-video w-full border-b border-border/60 bg-muted/40" />
              <div className="p-5">
                <div className="mb-3 h-4 w-3/5 rounded bg-muted/50" />
                <div className="h-3 w-4/5 rounded bg-muted/30" />
                <div className="mt-4 h-3 w-2/5 rounded bg-muted/20" />
              </div>
            </div>
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
          {projects.map((project) => (
            <div key={project.id} className="group relative">
              <Link
                href={`/projects/${project.id}`}
                className="flex flex-col justify-between overflow-hidden rounded-xl border border-border/60 bg-card/60 transition-colors hover:border-border hover:bg-card"
              >
                <div className="relative aspect-video w-full overflow-hidden border-b border-border/60 bg-black/30">
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
                    <h2 className="mb-3 truncate text-sm font-semibold text-foreground">
                      {project.name}
                    </h2>
                    {project.description ? (
                      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {project.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                    <HiClock className="size-3" />
                    Created {formatCreatedAt(project.createdAt)}
                  </div>
                </div>
              </Link>

              {/* Hover dropdown */}
              <div className={`absolute top-2 right-2 z-10 transition-opacity ${openDropdownId === project.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                <DropdownMenu onOpenChange={(open) => setOpenDropdownId(open ? project.id : null)}>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="flex size-7 items-center justify-center rounded-md bg-black/60 text-white backdrop-blur-sm hover:bg-black/80"
                      onClick={(e) => e.preventDefault()}
                    >
                      <HiEllipsisVertical className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.preventDefault();
                        setRenameName(project.name);
                        setRenameTarget(project);
                      }}
                    >
                      <HiPencil className="size-4" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={(e) => {
                        e.preventDefault();
                        setDeleteTarget(project);
                      }}
                    >
                      <HiTrash className="size-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Project</DialogTitle>
            <DialogDescription>Enter a new name for this project.</DialogDescription>
          </DialogHeader>
          <Input
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            placeholder="Project name"
            maxLength={200}
            onKeyDown={(e) => e.key === "Enter" && handleRename()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={renaming || !renameName.trim()}>
              {renaming ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.name}</strong> and all its files, messages, and sessions. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
