import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { installMarkdownDocumentSurfaces } from "./features/workspace/lib/markdownDocumentSurfaces";
import "./styles/app.css";

installMarkdownDocumentSurfaces(document);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
