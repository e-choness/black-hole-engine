import { useState } from 'react';
import { X } from 'lucide-react';
import { currentMode, type ObserverMode } from '../engine/engine';
import { useEngineValue } from '../engine/hooks';
import { useUi } from '../state/ui-store';
import { Hud } from './Hud';
import { TimeBar } from './TimeBar';

const HINTS_KEY = 'black-hole.hints';

function readHintsHidden(): boolean {
    try {
        return localStorage.getItem(HINTS_KEY) === 'hidden';
    } catch {
        return false;
    }
}

// What the observer does in each mode and how to look around, for a first visit.
function hintText(mode: ObserverMode, touch: boolean): string {
    if (mode === 'hover') {
        return 'Rockets hold you up as you are lowered toward the horizon · Drag to look around';
    }
    if (mode === 'dive')
        return 'You fall freely from rest, through the horizon · Drag to look around';
    return touch
        ? 'Drag to orbit · Pinch to zoom · Two-finger drag to pan'
        : 'Drag to orbit · Right-drag to pan · Scroll to zoom';
}

function Hints() {
    const [hidden, setHidden] = useState(readHintsHidden);
    const mode = useEngineValue(currentMode);
    const openShortcuts = useUi((state) => state.setShortcutsOpen);
    if (hidden) return null;
    const touch = window.matchMedia('(pointer: coarse)').matches;
    const hide = () => {
        setHidden(true);
        try {
            localStorage.setItem(HINTS_KEY, 'hidden');
        } catch {
            // The hints stay hidden for this visit only.
        }
    };
    return (
        <div className="hint glass">
            <span>{hintText(mode, touch)}</span>
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
                aria-label="Hide hints"
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
                    <Hints />
                    <TimeBar />
                </div>
            </div>
        </footer>
    );
}
