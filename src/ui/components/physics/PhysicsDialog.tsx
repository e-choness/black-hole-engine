import { lazy, Suspense } from 'react';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { portalContainer } from '../../lib/portal';
import { useUi } from '../../state/ui-store';

// The notes and their Markdown renderer load the first time the dialog opens.
const PhysicsNotes = lazy(() =>
    import('./PhysicsNotes').then((module) => ({ default: module.PhysicsNotes })),
);

export function PhysicsDialog() {
    const open = useUi((state) => state.physicsOpen);
    const setOpen = useUi((state) => state.setPhysicsOpen);
    return (
        <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Portal container={portalContainer()}>
                <Dialog.Overlay className="dialog-overlay" />
                <Dialog.Content className="physics bh-ui" aria-describedby={undefined}>
                    <div className="physics-head">
                        <Dialog.Title className="sheet-title">Physics</Dialog.Title>
                        <Dialog.Close className="icon-btn" aria-label="Close">
                            <X size={18} aria-hidden="true" />
                        </Dialog.Close>
                    </div>
                    <Suspense
                        fallback={
                            <p className="physics-loading" role="status">
                                Loading the notes…
                            </p>
                        }
                    >
                        <PhysicsNotes />
                    </Suspense>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
