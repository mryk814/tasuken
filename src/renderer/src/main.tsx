import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { installMarkdownDocumentSurfaces } from "./features/workspace/lib/markdownDocumentSurfaces";
import { installRendererPerformanceDiagnostics } from "./utils/performanceDiagnostics";
import "./styles/app.css";
import "./styles/notes-layout.css";

installMarkdownDocumentSurfaces(document);
installRendererPerformanceDiagnostics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
