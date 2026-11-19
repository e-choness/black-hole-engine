import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';
import './styles/ui.css';
import { App } from './App';

// Mounted once the engine has initialised (bootstrap.js), so every control can read it directly.
export function mountUi(): void {
    const host = document.createElement('div');
    host.id = 'ui-root';
    host.className = 'bh-ui';
    document.body.appendChild(host);
    createRoot(host).render(
        <StrictMode>
            <App />
        </StrictMode>,
    );
}
