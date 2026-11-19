import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';
import './styles/ui.css';
import type { EngineTextures } from './engine/engine';
import { Root } from './Root';

export function mountApp(textures: EngineTextures): void {
    const host = document.createElement('div');
    host.id = 'ui-root';
    host.className = 'bh-ui';
    document.body.appendChild(host);
    createRoot(host).render(
        <StrictMode>
            <Root textures={textures} />
        </StrictMode>,
    );
}
