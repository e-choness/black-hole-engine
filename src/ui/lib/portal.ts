// Radix portals render into the UI root so that overlays share its scoped styles.
export function portalContainer(): HTMLElement | undefined {
    return document.getElementById('ui-root') ?? undefined;
}
