"use client";

import Editor from "@monaco-editor/react";
import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  HiArrowPath,
  HiChevronDown,
  HiChevronRight,
  HiCommandLine,
  HiCodeBracket,
  HiEye,
  HiFolderOpen,
  HiOutlineArrowTopRightOnSquare,
  HiSparkles,
} from "react-icons/hi2";

type WorkspaceTab = "preview" | "files";

type WorkspaceFile = {
  path: string;
  isDir: boolean;
  language: string;
  content?: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "analyzing" | "streaming" | "completed" | "failed";
};

type FileNode = {
  name: string;
  path: string;
  isDir: boolean;
  children: FileNode[];
};

function randomId() {
  return crypto.randomUUID();
}

function getLanguageFromPath(path: string) {
  if (path.endsWith(".tsx") || path.endsWith(".ts")) {
    return "typescript";
  }
  if (path.endsWith(".css")) {
    return "css";
  }
  if (path.endsWith(".json")) {
    return "json";
  }
  if (path.endsWith(".js") || path.endsWith(".jsx")) {
    return "javascript";
  }

  return "plaintext";
}

function buildFileTree(entries: WorkspaceFile[]) {
  const root: FileNode = {
    name: "",
    path: "",
    isDir: true,
    children: [],
  };

  for (const entry of entries) {
    const segments = entry.path.split("/").filter(Boolean);
    let current = root;

    segments.forEach((segment, index) => {
      const nextPath = segments.slice(0, index + 1).join("/");
      const isLast = index === segments.length - 1;

      let child = current.children.find((node) => node.name === segment);
      if (!child) {
        child = {
          name: segment,
          path: nextPath,
          isDir: !isLast || entry.isDir,
          children: [],
        };
        current.children.push(child);
      }

      if (isLast) {
        child.isDir = entry.isDir;
      }

      current = child;
    });
  }

  const sortNodes = (nodes: FileNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDir && !b.isDir) {
        return -1;
      }
      if (!a.isDir && b.isDir) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });

    nodes.forEach((node) => {
      if (node.children.length > 0) {
        sortNodes(node.children);
      }
    });
  };

  sortNodes(root.children);
  return root.children;
}

export default function ProjectWorkspacePage() {
  const params = useParams<{ projectId: string }>();
  const projectId = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId;

  const [activeTab, setActiveTab] = useState<WorkspaceTab>("preview");
  const [projectName, setProjectName] = useState("");
  const [isProjectNameLoading, setIsProjectNameLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewNonce, setPreviewNonce] = useState(0);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isMessagesLoading, setIsMessagesLoading] = useState(true);
  const [bootstrapLogs, setBootstrapLogs] = useState<string[]>([]);
  const [activity, setActivity] = useState("Ready");
  const [isRunning, setIsRunning] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [isWorkspaceReady, setIsWorkspaceReady] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [queuedPrompt, setQueuedPrompt] = useState("");
  const [initialMessageIds, setInitialMessageIds] = useState<{
    userId: string;
    assistantId: string;
  } | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    src: true,
  });
  const initialPromptRan = useRef(false);
  const router = useRouter();

  const selectedFile = useMemo(() => files.find((file) => file.path === selectedFilePath), [files, selectedFilePath]);
  const fileTree = useMemo(() => buildFileTree(files), [files]);

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((current) => ({
      ...current,
      [path]: !current[path],
    }));
  }, []);

  const applyProjectName = useCallback((name: string) => {
    const normalized = name.trim();
    setProjectName(normalized);
    setIsProjectNameLoading(!normalized || normalized === "New Project");
  }, []);

  const loadMessages = useCallback(async (options?: { silent?: boolean }) => {
    if (!projectId) {
      return;
    }

    if (!options?.silent) {
      setIsMessagesLoading(true);
    }

    try {
      const response = await fetch(`/api/projects/${projectId}/messages`, { cache: "no-store" });
      const data = (await response.json()) as {
        messages?: Array<{
          id: string;
          role: "user" | "assistant";
          content: string;
          status: "analyzing" | "streaming" | "completed" | "failed";
        }>;
        error?: string;
      };

      if (!response.ok || !data.messages) {
        throw new Error(data.error ?? "Failed to load messages");
      }

      setMessages(data.messages);
    } catch (error) {
      setActivity(error instanceof Error ? error.message : "Failed to load messages");
    } finally {
      if (!options?.silent) {
        setIsMessagesLoading(false);
      }
    }
  }, [projectId]);

  const appendBootstrapLog = useCallback((raw: string) => {
    const lines = raw
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0);

    if (lines.length === 0) {
      return;
    }

    setBootstrapLogs((current) => {
      const next = [...current, ...lines];
      return next.slice(-120);
    });
  }, []);

  const loadFiles = useCallback(async () => {
    if (!projectId) {
      return;
    }

    const response = await fetch(`/api/projects/${projectId}/files`, { cache: "no-store" });
    const data = (await response.json()) as {
      entries?: Array<{ path: string; isDir: boolean }>;
      error?: string;
    };

    if (!response.ok || !data.entries) {
      throw new Error(data.error ?? "Failed to load files");
    }

    const mapped = data.entries
      .map((entry) => ({
        path: entry.path,
        isDir: entry.isDir,
        language: getLanguageFromPath(entry.path),
      }))
      .sort((a, b) => {
        if (a.isDir && !b.isDir) {
          return -1;
        }
        if (!a.isDir && b.isDir) {
          return 1;
        }
        return a.path.localeCompare(b.path);
      });

    setFiles(mapped);

    const currentSelected = mapped.find((file) => !file.isDir && file.path === selectedFilePath);
    if (!currentSelected) {
      const firstFile = mapped.find((file) => !file.isDir);
      if (firstFile) {
        setSelectedFilePath(firstFile.path);
      }
    }
  }, [projectId, selectedFilePath]);

  const loadFileContent = useCallback(
    async (path: string) => {
      if (!projectId) {
        return;
      }

      const response = await fetch(
        `/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
        { cache: "no-store" },
      );

      const data = (await response.json()) as {
        content?: string;
        error?: string;
      };

      if (!response.ok || typeof data.content !== "string") {
        throw new Error(data.error ?? "Failed to load file content");
      }

      setFiles((current) =>
        current.map((file) =>
          file.path === path
            ? {
                ...file,
                content: data.content,
              }
            : file,
        ),
      );
    },
    [projectId],
  );

  const appendAssistantText = useCallback((messageId: string, text: string) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              content: `${message.content}${text}`,
              status: "streaming",
            }
          : message,
      ),
    );
  }, []);

  const upsertFileFromToolInput = useCallback((input: unknown) => {
    if (!input || typeof input !== "object") {
      return;
    }

    const typedInput = input as Record<string, unknown>;
    const pathValue = typedInput.path;
    const contentValue = typedInput.content;

    if (typeof pathValue !== "string") {
      return;
    }

    if (typeof contentValue !== "string") {
      return;
    }

    setFiles((currentFiles) => {
      const existing = currentFiles.find((file) => file.path === pathValue);
      if (existing) {
        return currentFiles.map((file) =>
          file.path === pathValue
            ? {
                ...file,
                content: contentValue,
              }
            : file,
        );
      }

      return [
        ...currentFiles,
        {
          path: pathValue,
          isDir: false,
          language: getLanguageFromPath(pathValue),
          content: contentValue,
        },
      ];
    });
  }, []);

  const runPrompt = useCallback(async (
    prompt: string,
    options?: {
      existingMessageIds?: {
        userId: string;
        assistantId: string;
      };
    },
  ) => {
    const trimmedPrompt = prompt.trim();

    if (!projectId || !trimmedPrompt) {
      return;
    }

    if (!isWorkspaceReady) {
      setQueuedPrompt(trimmedPrompt);
      setActivity("Preparing workspace before generation...");
      return;
    }

    setQueuedPrompt("");
    setChatInput("");

    setIsRunning(true);
    setActivity("Analyzing...");

    const existingMessageIds = options?.existingMessageIds;
    const tempUserMessageId = existingMessageIds ? existingMessageIds.userId : `temp-user-${randomId()}`;
    const tempAssistantMessageId = existingMessageIds
      ? existingMessageIds.assistantId
      : `temp-assistant-${randomId()}`;
    let assistantMessageId = tempAssistantMessageId;

    if (existingMessageIds) {
      setMessages((current) =>
        current.map((message) =>
          message.id === existingMessageIds.assistantId
            ? {
                ...message,
                status: "analyzing",
              }
            : message,
        ),
      );
    } else {
      setMessages((current) => [
        ...current,
        { id: tempUserMessageId, role: "user", content: trimmedPrompt, status: "completed" },
        { id: tempAssistantMessageId, role: "assistant", content: "", status: "analyzing" },
      ]);
    }

    try {
      const response = await fetch(`/api/projects/${projectId}/runs/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: trimmedPrompt,
          userMessageId: existingMessageIds?.userId,
          assistantMessageId: existingMessageIds?.assistantId,
        }),
      });

      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to start streaming run");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const eventMatch = part.match(/^event:\s*(.+)$/m);
          const dataMatch = part.match(/^data:\s*(.+)$/m);

          if (!eventMatch || !dataMatch) {
            continue;
          }

          const eventName = eventMatch[1]?.trim();
          const payload = JSON.parse(dataMatch[1] ?? "{}");

            if (eventName === "run.started") {
            if (typeof payload.previewUrl === "string" && payload.previewUrl.length > 0) {
              setPreviewUrl(payload.previewUrl);
            }
            if (typeof payload.projectName === "string" && payload.projectName.length > 0) {
              applyProjectName(payload.projectName);
            }

            if (payload.userMessage && typeof payload.userMessage.id === "string") {
              setMessages((current) =>
                current.map((message) =>
                  message.id === tempUserMessageId
                    ? {
                        id: payload.userMessage.id,
                        role: "user",
                        content:
                          typeof payload.userMessage.content === "string"
                            ? payload.userMessage.content
                            : trimmedPrompt,
                        status: "completed",
                      }
                    : message,
                ),
              );
            }

            if (payload.assistantMessage && typeof payload.assistantMessage.id === "string") {
              assistantMessageId = payload.assistantMessage.id;
              setMessages((current) =>
                current.map((message) =>
                  message.id === tempAssistantMessageId
                    ? {
                        id: payload.assistantMessage.id,
                        role: "assistant",
                        content:
                          typeof payload.assistantMessage.content === "string"
                            ? payload.assistantMessage.content
                            : "",
                        status: "analyzing",
                      }
                    : message,
                ),
              );
            }

              setActivity("Run started");
              continue;
            }

            if (eventName === "preview.status") {
              if (typeof payload.message === "string" && payload.message.length > 0) {
                setActivity(payload.message);
              }
              continue;
            }

            if (eventName === "preview.ready") {
              if (typeof payload.previewUrl === "string" && payload.previewUrl.length > 0) {
                setPreviewUrl(payload.previewUrl);
              }
              setActivity("Preview ready");
              continue;
            }

          if (eventName === "project.renamed") {
            if (typeof payload.name === "string" && payload.name.length > 0) {
              applyProjectName(payload.name);
              setActivity(`Project renamed to ${payload.name}`);
            }
            continue;
          }

          if (eventName === "run.text") {
            if (typeof payload.text === "string") {
              appendAssistantText(assistantMessageId, payload.text);
            }
            setActivity("Generating...");
            continue;
          }

          if (eventName === "run.reasoning") {
            setActivity("Thinking...");
            continue;
          }

          if (eventName === "run.tool") {
            if (typeof payload.name === "string") {
              setActivity(`Tool: ${payload.name}`);
            }
            upsertFileFromToolInput(payload.input);
            continue;
          }

          if (eventName === "run.finished") {
            if (typeof payload.output === "string") {
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantMessageId
                    ? {
                        ...message,
                        content: payload.output,
                        status: "completed",
                      }
                    : message,
                ),
              );
            }
            setActivity("Run finished");
            continue;
          }

          if (eventName === "run.failed") {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      status: "failed",
                    }
                  : message,
              ),
            );
            setActivity("Run failed");
          }
        }

        await loadFiles();
      }

      await loadMessages({ silent: true });
    } catch (error) {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId || message.id === tempAssistantMessageId
            ? {
                ...message,
                status: "failed",
              }
            : message,
        ),
      );
      setActivity(error instanceof Error ? error.message : "Run failed");
    } finally {
      setIsRunning(false);
      setInitialMessageIds(null);
    }
  }, [appendAssistantText, applyProjectName, isWorkspaceReady, loadFiles, loadMessages, projectId, upsertFileFromToolInput]);

  const handleEnhancePrompt = async () => {
    const prompt = chatInput.trim();
    if (!prompt) {
      return;
    }

    setIsEnhancing(true);

    try {
      const response = await fetch("/api/prompts/enhance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt }),
      });

      const data = (await response.json()) as { enhancedPrompt?: string; error?: string };

      if (!response.ok || !data.enhancedPrompt) {
        throw new Error(data.error ?? "Failed to enhance prompt");
      }

      setChatInput(data.enhancedPrompt);
    } catch (error) {
      setActivity(error instanceof Error ? error.message : "Enhance failed");
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleCloseProject = async () => {
    if (!projectId || isClosing) {
      return;
    }

    setIsClosing(true);
    setActivity("Closing project...");

    try {
      const response = await fetch(`/api/projects/${projectId}/close`, {
        method: "POST",
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to close project");
      }

      router.push("/");
    } catch (error) {
      setActivity(error instanceof Error ? error.message : "Unable to close project");
      setIsClosing(false);
    }
  };

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const preview = query.get("preview") ?? "";
    const initialName = query.get("name") ?? "";
    const initialPrompt = query.get("prompt") ?? "";
    const initialUserMessageId = query.get("umid") ?? "";
    const initialAssistantMessageId = query.get("amid") ?? "";

    if (initialName) {
      applyProjectName(initialName);
    }

    if (
      initialPrompt &&
      initialUserMessageId &&
      initialAssistantMessageId &&
      !initialPromptRan.current
    ) {
      initialPromptRan.current = true;
      setQueuedPrompt(initialPrompt);
      setInitialMessageIds({
        userId: initialUserMessageId,
        assistantId: initialAssistantMessageId,
      });
      setMessages([
        {
          id: initialUserMessageId,
          role: "user",
          content: initialPrompt,
          status: "completed",
        },
        {
          id: initialAssistantMessageId,
          role: "assistant",
          content: "",
          status: "analyzing",
        },
      ]);
      setIsMessagesLoading(false);
    }

    if (preview) {
      setPreviewUrl(preview);
      setIsWorkspaceReady(true);
      setActivity("Project ready");
    } else if (projectId) {
      setIsOpening(true);
      setIsWorkspaceReady(false);
      setActivity("Preparing your workspace...");

      const abortController = new AbortController();

      void (async () => {
        try {
          const response = await fetch(`/api/projects/${projectId}/open/stream`, {
            method: "POST",
            signal: abortController.signal,
          });

          if (!response.ok || !response.body) {
            const data = (await response.json().catch(() => ({}))) as { error?: string };
            throw new Error(data.error ?? "Failed to open project");
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let openReadyReceived = false;

          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop() ?? "";

            for (const part of parts) {
              const eventMatch = part.match(/^event:\s*(.+)$/m);
              const dataMatch = part.match(/^data:\s*(.+)$/m);

              if (!eventMatch || !dataMatch) {
                continue;
              }

              const eventName = eventMatch[1]?.trim();
              const payload = JSON.parse(dataMatch[1] ?? "{}");

              if (eventName === "open.status") {
                if (typeof payload.message === "string" && payload.message.length > 0) {
                  setActivity(payload.message);
                  appendBootstrapLog(payload.message);
                }
                continue;
              }

              if (eventName === "open.log") {
                if (typeof payload.message === "string" && payload.message.length > 0) {
                  appendBootstrapLog(payload.message);
                }
                continue;
              }

              if (eventName === "project.renamed") {
                if (typeof payload.name === "string" && payload.name.length > 0) {
                  applyProjectName(payload.name);
                }
                continue;
              }

              if (eventName === "open.ready") {
                if (typeof payload.projectName === "string" && payload.projectName.length > 0) {
                  applyProjectName(payload.projectName);
                }

                setActivity("Workspace ready, generating your project...");
                setIsWorkspaceReady(true);
                setIsOpening(false);
                openReadyReceived = true;
                continue;
              }

              if (eventName === "open.failed") {
                setActivity(
                  typeof payload.error === "string" && payload.error.length > 0
                    ? payload.error
                    : "Failed to open project",
                );
                setMessages((current) =>
                  current.map((message) =>
                    message.role === "assistant" && message.status === "analyzing"
                      ? {
                          ...message,
                          status: "failed",
                        }
                      : message,
                  ),
                );
                setIsWorkspaceReady(false);
                setIsOpening(false);
              }
            }
          }

          if (!openReadyReceived && !abortController.signal.aborted) {
            setIsWorkspaceReady(false);
            setIsOpening(false);
          }
        } catch (error) {
          if (abortController.signal.aborted) {
            return;
          }
          setActivity(error instanceof Error ? error.message : "Failed to open project");
          setIsWorkspaceReady(false);
          setIsOpening(false);
        }
      })();

      return () => {
        abortController.abort();
      };
    }
  }, [appendBootstrapLog, applyProjectName, projectId]);

  useEffect(() => {
    if (!queuedPrompt || !isWorkspaceReady || isOpening || isRunning) {
      return;
    }

    void runPrompt(queuedPrompt, {
      existingMessageIds: initialMessageIds ?? undefined,
    });
  }, [initialMessageIds, isOpening, isRunning, isWorkspaceReady, queuedPrompt, runPrompt]);

  useEffect(() => {
    if (!projectId || !isWorkspaceReady) {
      return;
    }

    void loadFiles().catch((error: unknown) => {
      setActivity(error instanceof Error ? error.message : "Failed to load files");
    });
  }, [isWorkspaceReady, loadFiles, projectId]);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    void loadMessages({ silent: messages.length > 0 });
  }, [loadMessages, messages.length, projectId]);

  useEffect(() => {
    if (!selectedFile || selectedFile.isDir || typeof selectedFile.content === "string") {
      return;
    }

    void loadFileContent(selectedFile.path).catch((error: unknown) => {
      setActivity(error instanceof Error ? error.message : "Failed to load file");
    });
  }, [loadFileContent, selectedFile]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto grid min-h-screen w-full max-w-[1800px] grid-cols-1 gap-3 p-3 lg:grid-cols-[420px_1fr]">
        <section className="flex min-h-[40vh] flex-col rounded-2xl border border-border/70 bg-card/60 p-4 lg:min-h-0">
          <div className="mb-4 flex items-center justify-between">
            <div>
              {isProjectNameLoading ? (
                <div className="h-7 w-40 animate-pulse rounded-md bg-secondary/70" />
              ) : (
                <h1 className="text-xl font-semibold tracking-tight">{projectName}</h1>
              )}
              <p className="text-sm text-muted-foreground">{projectId}</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={handleCloseProject}
              disabled={isClosing || isOpening || isRunning}
            >
              {isClosing ? "Closing..." : "Close Project"}
            </Button>
          </div>

          <div className="mb-4 flex-1 space-y-4 overflow-auto pr-1">
            {isMessagesLoading ? (
              <div className="space-y-2">
                <div className="h-12 w-[70%] animate-pulse rounded-2xl bg-secondary/60" />
                <div className="ml-auto h-12 w-[62%] animate-pulse rounded-2xl bg-blue-500/20" />
              </div>
            ) : messages.length === 0 ? (
              <div className="rounded-xl border border-border/60 bg-background/50 p-3 text-sm text-muted-foreground">
                Send your first prompt to start generating files.
              </div>
            ) : null}

            {messages.map((message) => (
              <div
                key={message.id}
                className={`w-fit max-w-[92%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                  message.role === "user"
                    ? "ml-auto bg-blue-500/90 text-white"
                    : "border border-border/70 bg-background/70"
                }`}
              >
                {message.content || (message.role === "assistant" ? "Analyzing..." : "")}
              </div>
            ))}

            {bootstrapLogs.length > 0 && !previewUrl ? (
              <div className="rounded-xl border border-border/70 bg-background/60 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                  <HiCommandLine className="size-4" />
                  Bootstrap Logs
                </div>
                <pre className="max-h-44 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {bootstrapLogs.join("\n")}
                </pre>
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground">{activity}</p>
          </div>

          <div className="space-y-3 rounded-xl border border-border/70 bg-background/60 p-3">
            <textarea
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Describe what you want to build..."
              className="min-h-28 w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <div className="flex items-center justify-between gap-2">
              <Button
                size="sm"
                type="button"
                variant="secondary"
                onClick={handleEnhancePrompt}
                disabled={isEnhancing || isRunning || isOpening || isClosing || !chatInput.trim()}
              >
                <HiSparkles className="size-4" />
                Enhance
              </Button>
              <Button
                size="sm"
                type="button"
                disabled={isRunning || isClosing || !chatInput.trim()}
                onClick={() => void runPrompt(chatInput)}
              >
                Send
              </Button>
            </div>
          </div>
        </section>

        <section className="flex min-h-[60vh] flex-col rounded-2xl border border-border/70 bg-card/60 lg:min-h-0">
          <header className="flex items-center justify-between border-b border-border/70 px-3 py-2">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={activeTab === "preview" ? "default" : "secondary"}
                onClick={() => setActiveTab("preview")}
              >
                <HiEye className="size-4" />
                Preview
              </Button>
              <Button
                size="sm"
                variant={activeTab === "files" ? "default" : "secondary"}
                onClick={() => setActiveTab("files")}
              >
                <HiCodeBracket className="size-4" />
                Files
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                aria-label="Refresh preview"
                onClick={() => setPreviewNonce((value) => value + 1)}
              >
                <HiArrowPath className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                aria-label="Refresh files"
                onClick={() => {
                  void loadFiles().catch((error: unknown) => {
                    setActivity(error instanceof Error ? error.message : "Failed to refresh files");
                  });
                }}
              >
                <HiArrowPath className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                aria-label="Open preview in new tab"
                asChild
              >
                <a href={previewUrl || "#"} target="_blank" rel="noreferrer">
                  <HiOutlineArrowTopRightOnSquare className="size-4" />
                </a>
              </Button>
            </div>
          </header>

          {activeTab === "preview" ? (
            <div className="relative flex-1 overflow-hidden rounded-b-2xl bg-background">
              {previewUrl ? (
                <iframe
                  src={`${previewUrl}${previewUrl.includes("?") ? "&" : "?"}v=${previewNonce}`}
                  title="Project preview"
                  className="h-full w-full"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
                />
              ) : (
                <div className="grid h-full place-items-center p-8 text-center">
                  <div className="max-w-md space-y-2 rounded-xl border border-border/70 bg-card/60 p-5">
                    <div className="mx-auto h-4 w-36 animate-pulse rounded bg-secondary/70" />
                    <p className="text-sm font-medium">Preview is starting</p>
                    <p className="text-xs text-muted-foreground">
                      Once the Upstash preview URL is ready, it will appear here automatically.
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[260px_1fr]">
              <aside className="border-b border-border/70 bg-background/50 p-3 lg:border-b-0 lg:border-r">
                <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                  <HiFolderOpen className="size-4" />
                  Files
                </div>
                <div className="space-y-1">
                  {fileTree.map((node) => {
                    const renderNode = (currentNode: FileNode, depth: number) => {
                      const isExpanded = expandedFolders[currentNode.path] ?? false;

                      if (currentNode.isDir) {
                        return (
                          <div key={`dir-${currentNode.path}`}>
                            <button
                              type="button"
                              onClick={() => toggleFolder(currentNode.path)}
                              className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-secondary/60"
                              style={{ paddingLeft: `${8 + depth * 12}px` }}
                            >
                              {isExpanded ? <HiChevronDown className="size-3" /> : <HiChevronRight className="size-3" />}
                              <span className="truncate">{currentNode.name}</span>
                            </button>
                            {isExpanded
                              ? currentNode.children.map((child) => renderNode(child, depth + 1))
                              : null}
                          </div>
                        );
                      }

                      return (
                        <button
                          key={currentNode.path}
                          type="button"
                          onClick={() => setSelectedFilePath(currentNode.path)}
                          className={`block w-full rounded-md px-2 py-1.5 text-left text-xs ${
                            selectedFile?.path === currentNode.path
                              ? "bg-secondary text-foreground"
                              : "text-muted-foreground hover:bg-secondary/60"
                          }`}
                          style={{ paddingLeft: `${8 + depth * 12}px` }}
                        >
                          {currentNode.name}
                        </button>
                      );
                    };

                    return renderNode(node, 0);
                  })}
                </div>
              </aside>

              <div className="min-h-[420px]">
                <Editor
                  height="100%"
                  language={selectedFile?.language ?? "typescript"}
                  value={selectedFile?.content ?? ""}
                  theme="vs-dark"
                  onChange={(value) => {
                    if (!selectedFile) {
                      return;
                    }

                    setFiles((currentFiles) =>
                      currentFiles.map((file) =>
                        file.path === selectedFile.path
                          ? {
                              ...file,
                              content: value ?? "",
                            }
                          : file,
                      ),
                    );
                  }}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    smoothScrolling: true,
                    automaticLayout: true,
                  }}
                />
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
