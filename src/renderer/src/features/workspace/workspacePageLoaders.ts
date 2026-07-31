const pageLoaders: Record<string, () => Promise<unknown>> = {
  inbox: () => import("./pages/InboxPage"),
  "chat-refs": () => import("./pages/ChatRefsPage"),
  artifacts: () => import("./pages/ArtifactsPage"),
  theme: () => import("./pages/ThemePage"),
  todo: () => import("./pages/TodoPage"),
  timeline: () => import("./pages/TimelinePage"),
  themes: () => import("./pages/ThemesPage"),
  notes: () => import("./pages/NotesPage"),
  knowledge: () => import("./pages/KnowledgePage"),
  waiting: () => import("./pages/WaitingPage"),
  "ai-io": () => import("./pages/ImportExportPage"),
  settings: () => import("./pages/SettingsPage"),
};

export function loadWorkspacePage(route: string): Promise<unknown> {
  return pageLoaders[route]?.() ?? Promise.resolve();
}

export function preloadWorkspacePage(route: string): void {
  void loadWorkspacePage(route);
}

export function preloadWorkspacePagesWhenIdle(): () => void {
  const routes = ["todo", "inbox", "timeline", "knowledge", "notes", "chat-refs", "artifacts", "ai-io", "settings"];
  let cancelled = false;
  let idleId: number | null = null;

  const loadNext = () => {
    if (cancelled) return;
    const route = routes.shift();
    if (!route) return;
    void loadWorkspacePage(route).finally(() => {
      if (cancelled) return;
      if ("requestIdleCallback" in window) {
        idleId = window.requestIdleCallback(loadNext, { timeout: 1200 });
      } else {
        idleId = globalThis.setTimeout(loadNext, 80);
      }
    });
  };

  if ("requestIdleCallback" in window) {
    idleId = window.requestIdleCallback(loadNext, { timeout: 1200 });
  } else {
    idleId = globalThis.setTimeout(loadNext, 300);
  }

  return () => {
    cancelled = true;
    if (idleId === null) return;
    if ("cancelIdleCallback" in window) window.cancelIdleCallback(idleId);
    else globalThis.clearTimeout(idleId);
  };
}
