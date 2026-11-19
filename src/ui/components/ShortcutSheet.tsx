import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { MOD_KEY } from '../lib/keys';
import { portalContainer } from '../lib/portal';
import { SHORTCUT_GROUPS } from '../state/shortcuts';
import { useUi } from '../state/ui-store';

const LINKS = [
    { href: 'https://github.com/Adriwin06/black-hole#readme', label: 'About this simulation' },
    { href: 'https://github.com/Adriwin06/black-hole', label: 'Source code' },
    { href: 'docs/LEGAL.md', label: 'Legal notices and licenses' },
];

export function ShortcutSheet() {
    const open = useUi((state) => state.shortcutsOpen);
    const setOpen = useUi((state) => state.setShortcutsOpen);
    return (
        <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Portal container={portalContainer()}>
                <Dialog.Overlay className="dialog-overlay" />
                <Dialog.Content className="sheet glass bh-ui" aria-describedby={undefined}>
                    <div className="sheet-head">
                        <Dialog.Title className="sheet-title">Keyboard shortcuts</Dialog.Title>
                        <Dialog.Close className="icon-btn" aria-label="Close">
                            <X size={18} aria-hidden="true" />
                        </Dialog.Close>
                    </div>
                    <div className="sheet-groups">
                        {SHORTCUT_GROUPS.map((group) => (
                            <section key={group.title} className="sheet-group">
                                <h3 className="caps-label">{group.title}</h3>
                                <dl>
                                    {group.shortcuts.map((shortcut) => (
                                        <div key={shortcut.label} className="shortcut-row">
                                            <dt>{shortcut.label}</dt>
                                            <dd>
                                                {shortcut.keys.map((key) => (
                                                    <kbd key={key} className="kbd">
                                                        {key === 'Ctrl' ? MOD_KEY : key}
                                                    </kbd>
                                                ))}
                                            </dd>
                                        </div>
                                    ))}
                                </dl>
                            </section>
                        ))}
                    </div>
                    <nav className="sheet-links" aria-label="About">
                        {LINKS.map((link) => (
                            <a key={link.href} href={link.href} target="_blank" rel="noopener">
                                {link.label}
                            </a>
                        ))}
                    </nav>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
