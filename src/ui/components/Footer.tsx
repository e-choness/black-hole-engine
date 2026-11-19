import { useState } from 'react';
import { X } from 'lucide-react';
import { useUi } from '../state/ui-store';
import { Hud } from './Hud';
import { TimeBar } from './TimeBar';

const HINT_KEY = 'black-hole.hint.camera';

function readHintHidden(): boolean {
    try {
        return localStorage.getItem(HINT_KEY) === 'hidden';
    } catch {
        return false;
    }
}

function CameraHint() {
    const [hidden, setHidden] = useState(readHintHidden);
    const openShortcuts = useUi((state) => state.setShortcutsOpen);
    if (hidden) return null;
    const touch = window.matchMedia('(pointer: coarse)').matches;
    const hide = () => {
        setHidden(true);
        try {
            localStorage.setItem(HINT_KEY, 'hidden');
        } catch {
            // The hint stays hidden for this visit only.
        }
    };
    return (
        <div className="hint glass">
            <span>
                {touch
                    ? 'Drag to orbit · Pinch to zoom · Two-finger drag to pan'
                    : 'Drag to orbit · Right-drag to pan · Scroll to zoom'}
            </span>
            {!touch && (
                <button
                    type="button"
                    className="hint-shortcuts"
                    onClick={() => openShortcuts(true)}
                >
                    <kbd className="kbd">?</kbd>
                    shortcuts
                </button>
            )}
            <button
                type="button"
                className="icon-btn icon-btn--sm"
                aria-label="Hide hint"
                onClick={hide}
            >
                <X size={14} aria-hidden="true" />
            </button>
        </div>
    );
}

export function Footer() {
    return (
        <footer className="shell-footer">
            <div className="footer-layout">
                <Hud />
                <div className="footer-center">
                    <CameraHint />
                    <TimeBar />
                </div>
            </div>
        </footer>
    );
}
