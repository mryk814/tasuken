import type { PageProps, Theme } from "../types";
import { ArtifactsPage } from "../pages/ArtifactsPage";
import { ChatRefsPage } from "../pages/ChatRefsPage";
import { ImportExportPage } from "../pages/ImportExportPage";
import { InboxPage } from "../pages/InboxPage";
import { KnowledgePage } from "../pages/KnowledgePage";
import { NotesPage } from "../pages/NotesPage";
import { SettingsPage } from "../pages/SettingsPage";
import { ThemePage } from "../pages/ThemePage";
import { ThemesPage } from "../pages/ThemesPage";
import { TimelinePage } from "../pages/TimelinePage";
import { TodayPage } from "../pages/TodayPage";
import { TodoPage } from "../pages/TodoPage";
import { WaitingPage } from "../pages/WaitingPage";

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
  switch (route) {
    case "inbox":
      return <InboxPage {...common} />;
    case "chat-refs":
      return <ChatRefsPage {...common} />;
    case "artifacts":
      return <ArtifactsPage {...common} />;
    case "theme":
      return <ThemePage {...common} />;
    case "todo":
      return <TodoPage {...common} />;
    case "timeline":
      return <TimelinePage {...common} />;
    case "themes":
      return <ThemesPage {...common} />;
    case "notes":
      return <NotesPage {...common} />;
    case "knowledge":
      return <KnowledgePage {...common} />;
    case "waiting":
      return <WaitingPage {...common} />;
    case "ai-io":
      return <ImportExportPage {...common} />;
    case "settings":
      return (
        <SettingsPage
          {...common}
          themeMode={themeMode}
          setThemeMode={setThemeMode}
          activeGroups={activeGroups}
          setActiveGroups={setActiveGroups}
          allThemes={allThemes}
        />
      );
    default:
      return <TodayPage {...common} />;
  }
}
