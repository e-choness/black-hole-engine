const CONTROL_SELECTORS = [
    '[role="slider"]',
    '[role="switch"]',
    '[role="radio"][aria-checked="true"]',
    '[role="combobox"]',
    'button',
];

// Focuses the main control of a parameter row: its slider, switch, selected option or menu.
export function focusControl(root: Element | null): void {
    for (const selector of CONTROL_SELECTORS) {
        const control = root?.querySelector<HTMLElement>(selector);
        if (control) {
            control.focus();
            return;
        }
    }
}
