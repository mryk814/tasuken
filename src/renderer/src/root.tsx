import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { TaskenRootApp } from "./tasken-root/TaskenRootApp";
import "./tasken-root/tasken-root.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TaskenRootApp />
  </StrictMode>,
);
