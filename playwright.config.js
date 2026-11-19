import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const baseURL = `http://127.0.0.1:${PORT}/`;

export default defineConfig({
    testDir: 'tests/e2e',
    outputDir: '.cache/playwright/test-results',
    reporter: [['list'], ['html', { outputFolder: '.cache/playwright/report', open: 'never' }]],
    timeout: 180_000,
    expect: { timeout: 60_000 },
    forbidOnly: Boolean(process.env.CI),
    workers: 1,
    use: {
        baseURL,
        trace: 'retain-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 800, height: 450 },
                deviceScaleFactor: 1,
                launchOptions: {
                    // Software WebGL2 so the suite runs on GPU-less CI machines.
                    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
                },
            },
        },
    ],
    webServer: {
        command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 180_000,
    },
});
