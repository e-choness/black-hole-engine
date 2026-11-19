import { useEffect } from 'react';
import { Toaster, toast } from 'sonner';
import { setNoticeHandler } from '../engine/engine';

interface PwaUpdateDetail {
    applyUpdate?: () => void;
}

// Engine hints and service-worker events become toasts; the region is a polite live region.
export function Notices() {
    useEffect(() => {
        setNoticeHandler((text, options) => {
            toast(text, { id: options.kind });
        });
        const offline = () => toast.success('Ready offline', { id: 'pwa' });
        const update = (event: Event) => {
            const detail = (event as CustomEvent<PwaUpdateDetail>).detail;
            toast('A new version is available', {
                id: 'pwa-update',
                duration: Infinity,
                action: { label: 'Reload', onClick: () => detail?.applyUpdate?.() },
            });
        };
        window.addEventListener('bh:pwa-offline-ready', offline);
        window.addEventListener('bh:pwa-update-ready', update);
        return () => {
            setNoticeHandler(() => {});
            window.removeEventListener('bh:pwa-offline-ready', offline);
            window.removeEventListener('bh:pwa-update-ready', update);
        };
    }, []);
    return (
        <Toaster
            position="top-center"
            theme="dark"
            offset={76}
            mobileOffset={{ top: 68 }}
            gap={8}
            containerAriaLabel="Notifications"
            toastOptions={{ unstyled: true, className: 'toast', duration: 3200 }}
        />
    );
}
