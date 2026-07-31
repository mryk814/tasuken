import { lazy, Suspense, useEffect, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";

import type { PageProps, Theme } from "../types";
import { TodayPage } from "../pages/TodayPage";
import { loadWorkspacePage, preloadWorkspacePagesWhenIdle } from "../workspacePageLoaders";

type SettingsPageProps = PageProps & {
  themeMode: "light" | "dark";
  setThemeMode: (mode: "light" | "dark") => void;
  activeGroups: string[];
  setActiveGroups: (groups: string[]) => void;
  allThemes: Theme[];
};

function lazyNamedPage<P>(
  loader: () => Promise<unknown>,
  exportName: string,
): LazyExoticComponent<ComponentType<P>> {
  return lazy(async () => {
    const module = await loader() as Record<string, ComponentType<P>>;
    return { default: module[exportName] };
  });
}

const ArtifactsPage = lazyNamedPage<PageProps>(() => loadWorkspacePage("artifacts"), "ArtifactsPage");
const ChatRefsPage = lazyNamedPage<PageProps>(() => loadWorkspacePage("chat-refs"), "ChatRefsPage");
const ImportExportPage = lazyNamedPage<PageProps>(() => loadWorkspacePage("ai-io"), "ImportExportPage");
const InboxPage = lazyNamedPage<PageProps>(() => loadWorkspacePage("inbox"), "InboxPage");
const KnowledgePage = lazyNamedPage<PageProps>(() => loadWorkspacePage("knowledge"), "KnowledgePage");
const NotesPage = lazyNamedPage<PageProps>(() => loadWorkspacePage("notes"), "NotesPage");
const SettingsPage = lazyNamedPage<SettingsPageProps>(() => loadWorkspacePage("settings"), "SettingsPage");
const ThemePage = lazyNamedPage<PageProps>(() => loadWorkspacePage("theme"), "ThemePage");
const ThemesPage = lazyNamedPage<PageProps>(() => loadWorkspacePage("themes"), "ThemesPage");
const TimelinePage = lazyNamedPage<PageProps>(() => loadWorkspacePage("timeline"), "TimelinePage");
const TodoPage = lazyNamedPage<PageProps>(() => loadWorkspacePage("todo"), "TodoPage");
const WaitingPage = lazyNamedPage<PageProps>(() => loadWorkspacePage("waiting"), "WaitingPage");

export function WorkspacePageRouter({
  route,
  common,
  themeMode,
  setThemeMode,
  activeGroups,
  setActiveGroups,
  allThemes,
}: {
  route: string;
  common: PageProps;
  themeMode: "light" | "dark";
  setThemeMode: (mode: "light" | "dark") => void;
  activeGroups: string[];
  setActiveGroups: (groups: string[]) => void;
  allThemes: Theme[];
}) {
  useEffect(() => preloadWorkspacePagesWhenIdle(), []);

  let page: ReactNode;
  switch (route) {
    case "inbox":
      page = <InboxPage {...common} />;
      break;
    case "chat-refs":
      page = <ChatRefsPage {...common} />;
      break;
    case "artifacts":
      page = <ArtifactsPage {...common} />;
      break;
    case "theme":
      page = <ThemePage {...common} />;
      break;
    case "todo":
      page = <TodoPage {...common} />;
      break;
    case "timeline":
      page = <TimelinePage {...common} />;
      break;
    case "themes":
      page = <ThemesPage {...common} />;
      break;
    case "notes":
      page = <NotesPage {...common} />;
      break;
    case "knowledge":
      page = <KnowledgePage {...common} />;
      break;
    case "waiting":
      page = <WaitingPage {...common} />;
      break;
    case "ai-io":
      page = <ImportExportPage {...common} />;
      break;
    case "settings":
      page = (
        <SettingsPage
          {...common}
          themeMode={themeMode}
          setThemeMode={setThemeMode}
          activeGroups={activeGroups}
          setActiveGroups={setActiveGroups}
          allThemes={allThemes}
        />
      );
      break;
    default:
      page = <TodayPage {...common} />;
  }

  return (
    <Suspense fallback={<main className="workspace-route-loading" role="status"><span className="spinner" /></main>}>
      {page}
    </Suspense>
  );
}
