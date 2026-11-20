// Shared steps for the end-to-end tests.

import AxeBuilder from '@axe-core/playwright';

const BLOCKING = new Set(['serious', 'critical']);

// Serious and critical axe violations in the interface, overlays included, as readable lines.
export async function blockingViolations(page) {
    const results = await new AxeBuilder({ page }).include('#ui-root').analyze();
    return results.violations
        .filter((violation) => BLOCKING.has(violation.impact))
        .map((violation) => `${violation.id}: ${violation.nodes.map((n) => n.target).join(' | ')}`);
}

// Collects console errors, deprecation notices (from three.js, React or any other dependency) and
// uncaught page errors; every test expects the list to stay empty.
export function trackPageProblems(page) {
    const problems = [];
    page.on('console', (message) => {
        const text = message.text();
        // Libraries announce deprecations through console.warn, console.log or console.error.
        if (message.type() === 'error') problems.push(`console.error: ${text}`);
        else if (/deprecat/i.test(text)) problems.push(`deprecation notice: ${text}`);
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    return problems;
}

// Opens the simulation with the mobile preset and the frozen e2e clock, then waits until the
// first frame has been presented.
export async function openSimulation(page) {
    await page.goto('./?quality=mobile&e2e=1');
    await page.waitForFunction(() => window.__BH__ !== undefined);
    await page.evaluate(() => window.__BH__.ready);
}
