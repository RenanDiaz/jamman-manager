import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { Patch } from "./types/index.ts";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

declare global {
  interface Window {
    electronAPI: {
      selectFolder: () => Promise<string>;
      readPatches: (folderPath: string) => Promise<Patch[]>;
    };
  }
}
