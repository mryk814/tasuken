import { config as configureZod } from "zod/v4";

// Preload contracts run across a contextBridge into a renderer with a strict CSP.
// Disable Zod's Function-constructor fast path before any contract schema is created.
configureZod({ jitless: true });
