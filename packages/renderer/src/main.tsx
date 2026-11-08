import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import App from './App.tsx';
import type { ElectronAPI } from '@app/preload/ipc-contract';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

declare global {
  interface Window {
    /** Exposed by the preload (packages/preload/src/index.ts). */
    electronAPI: ElectronAPI;
  }
}
