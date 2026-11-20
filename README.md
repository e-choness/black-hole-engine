# Black Hole Simulation

A real-time black hole renderer that runs in the browser. Every pixel traces a light ray through
curved spacetime on the GPU with WebGL 2, so the lensed sky, the accretion flow and relativistic
jets are recomputed live as you move the camera or change the physics. A timeline editor turns any
setup into a scripted presentation that can be recorded to video.

## Features

- Gravitational lensing with three solvers: the exact Schwarzschild photon-orbit (Binet) equation,
  the same light paths with Kerr disk velocities, and full Kerr geodesics, which reproduce the
  flattened, shifted shadow of a spinning black hole.
- Accretion flows: a Novikov-Thorne thin disk with Kerr redshift, thick ADAF/RIAF torus,
  super-Eddington slim disk and GRMHD-inspired variants, with Doppler beaming, gravitational
  redshift and blackbody colours.
- Relativistic jets, an orbiting planet lit by the disk, and a lensed, rotating procedural galaxy
  and star field that can be seen from outside, from its centre or from within its disk.
- Physical scale: masses from stellar black holes to quasars, with presets such as Sgr A*, M87*,
  Cygnus X-1 and TON 618, derived quantities in physical units, and clocks that compare your
  proper time with a distant observer's.
- AgX, Khronos PBR Neutral, ACES and false-colour scientific tone mapping, energy-conserving
  bloom, temporal anti-aliasing and the accumulation of still views. Quality presets range from
  Mobile to Cinematic, and a one-time GPU benchmark picks the default.
- Observer orbits plus scripted "dive" and "hover" scenarios.
- Camera controls: drag to orbit, right-drag to pan, drag with both buttons to roll and scroll to
  zoom. On touch screens one finger orbits, two fingers pan and a pinch zooms.
- Presentation timeline with keyframed parameters, camera motion, annotations, bundled tours and
  JSON import/export.
- An interface with a searchable parameter inspector, a command palette (Ctrl/Cmd+K), keyboard
  shortcuts (?), physics notes, sound that follows the simulation and a layout for phones.
- Links that restore the whole view, and an installable app that works offline.
- Capture: PNG screenshots, frame-exact offline rendering to MP4 (H.264) or WebM (VP9 or AV1)
  through WebCodecs and [Mediabunny](https://mediabunny.dev), and real-time recording through
  MediaRecorder. Where the File System Access API is available, offline renders stream straight
  into the chosen file instead of being held in memory.

The simulation needs a browser with WebGL 2 and explains in the page when it is missing. Offline
recording also needs WebCodecs.

## Quick start

The only requirement is Docker with Compose v2. Nothing is installed on the host: every tool runs
in a container.

```sh
docker compose up dev
```

Then open <http://localhost:5173>. Source changes reload in the browser.

| Command                                          | What it does                                                  |
| ------------------------------------------------ | ------------------------------------------------------------- |
| `docker compose up dev`                          | Vite dev server with hot module reload                        |
| `docker compose run --rm test`                   | ESLint, Prettier check and Vitest unit tests                  |
| `docker compose run --rm build`                  | Production build into `dist/`                                 |
| `docker compose up --build preview`              | Production nginx image on <http://localhost:8080>             |
| `docker compose run --rm e2e`                    | Playwright e2e tests in headless Chromium with software WebGL |
| `docker compose run --rm test npm run format`    | Format with Prettier and apply ESLint fixes                   |
| `docker compose run --rm test npm install <pkg>` | Add a dependency (updates `package.json` and the lockfile)    |
| `docker compose down --remove-orphans`           | Stop and remove the project's containers                      |

Settings can be exported or put in a `.env` file next to `compose.yaml`:

| Variable           | Default    | Purpose                                                              |
| ------------------ | ---------- | -------------------------------------------------------------------- |
| `BH_DEV_PORT`      | `5173`     | Host port of the dev server                                          |
| `BH_PREVIEW_PORT`  | `8080`     | Host port of the preview server                                      |
| `BH_CACHE_DIR`     | `./.cache` | Directory that holds every cache                                     |
| `BH_WATCH_POLLING` | `1`        | Poll for file changes; Docker Desktop bind mounts drop change events |

The test, build and e2e services never publish ports, so they can run while the dev server is up.
The Compose project name comes from the directory, so separate checkouts (for example git
worktrees) get their own containers and volumes.

## Caches and volumes

All caches live under `BH_CACHE_DIR` (`.cache/`, ignored by git) and are bind-mounted into the
containers:

| Path                 | Contents                                                                   |
| -------------------- | -------------------------------------------------------------------------- |
| `.cache/npm`         | npm download cache shared by all tooling containers                        |
| `.cache/screenshots` | Screenshots from the smoke e2e test (`smoke-page.png`, `smoke-render.png`) |
| `.cache/playwright`  | Playwright HTML report (`report/`) and failure traces (`test-results/`)    |

`node_modules` lives in named volumes scoped to the Compose project (`node_modules` for the Node
tooling, `node_modules_e2e` for the Playwright image), so the host never receives a Linux
dependency tree. The container entrypoint runs `npm ci` automatically whenever `package-lock.json`
changes, so dependency updates do not require an image rebuild.

Images, containers and volumes carry the label `com.black-hole.project=black-hole`:

```sh
docker compose down --volumes --remove-orphans
docker image prune --all --filter label=com.black-hole.project=black-hole
```

## Deployment

**GitHub Pages.** On every push to `main`, CI lints, tests and builds the site, runs the e2e test
and deploys `dist/` to GitHub Pages (set the Pages source to "GitHub Actions"). Asset URLs are
relative, so the site works under a project sub-path. Pages cannot send custom headers, so the
build embeds the Content Security Policy as a `<meta>` tag.

**Container.** The `runtime` stage of the Dockerfile serves the build with unprivileged nginx on
port 8080: content-hashed assets are cached for a year, `index.html` and the service worker are
always revalidated, responses are gzip-compressed and every response carries the security headers.
`/healthz` serves the container health check.

```sh
docker build --target runtime --tag black-hole:local .
docker run --rm -p 8080:8080 --read-only --tmpfs /tmp --cap-drop ALL black-hole:local
```

The security headers, including a CSP that allows WebGL2, WebCodecs, Web Audio worklets and
service workers, are defined once in `config/security-headers.js` and applied to the Vite preview
server, the build-time `<meta>` tag and the nginx configuration.

## Project structure

```text
index.html               page shell and Vite entry
src/app/main.js          application entry point
src/app/core/            renderer, render loop, runtime state, observer physics, scenarios
src/app/graphics/        bloom and the shared full-screen pass helpers
src/app/presentation/    timeline editor, presentation runtime and recording, bundled presets
src/app/scene/           camera runtime and the mouse and touch observer controls
src/app/sky/             procedural galaxy drawn into the sky cube map
src/app/ui/              engine actions for the interface, quality presets, colour-bar widget
src/ui/                  React interface: top bar, mode rail, inspector, time bar and dialogs
src/ui/viewport/         React Three Fiber canvas that creates the renderer and runs the frame loop
src/features/            galaxy model, units, clocks, sonification, view links and the offline app
src/content/             physics notes shown in the app
src/shaders/raytracer/   GLSL ES 3.00 ray tracer; index.js sets the order the shards are joined in
src/styles/              stylesheets of the page and the timeline editor
public/                  files served as-is: textures and icons
tests/unit/              Vitest unit tests
tests/e2e/               Playwright tests: rendering, controls, recording, missing WebGL 2
config/                  build settings: security headers, PWA, link previews, legal notice
docker/                  container entrypoint and nginx configuration
scripts/                 build helpers
.github/                 CI workflow and Dependabot configuration
```

## Test hooks

Two URL parameters make the app scriptable:

- `?quality=<preset>` starts with a quality preset (`mobile`, `optimal`, `medium`, `high`, `ultra`
  or `cinematic`) and skips the GPU benchmark. Unknown values are ignored.
- `?e2e=1` makes rendering deterministic: it skips the benchmark, ignores a preset stored by an
  earlier visit and freezes the simulation clock, so every frame shows the same scene.

`window.__BH__` is always defined and read-only:

| Property            | Description                                                                     |
| ------------------- | ------------------------------------------------------------------------------- |
| `ready`             | Promise that resolves on the animation frame after the first rendered frame     |
| `frameCount`        | Number of frames rendered so far                                                |
| `params`            | Live shader parameters (`null` before initialisation)                           |
| `accumulatedFrames` | Frames in the running mean of a static view                                     |
| `viewport`          | `{ canvas, passes }`: drawing-buffer and scene-target size as `[width, height]` |
| `sky`               | Galaxy sky status: cube face size, particle counts, colour format, revision     |
| `probeSky`          | `probeSky(width, height)` reads the sky cube back as equirectangular RGB        |

```js
await page.goto('/?quality=mobile&e2e=1');
await page.evaluate(() => window.__BH__.ready);
await page.waitForFunction(() => window.__BH__.frameCount >= 24);
```

The WebGL canvas has the id `bh-canvas`.

`window.blackHolePresentation` is the presentation API the e2e tests drive, for example
`loadPreset(name)`, `startRecording(options)` (a promise that resolves to `true` once recording
has started), `stopRecording()`, `state()` and `getPathValue(path)`.

## Contributing

- Use [Conventional Commits](https://www.conventionalcommits.org/) with one change per commit.
- Run `docker compose run --rm test` and `docker compose run --rm e2e` before opening a pull
  request; CI runs the same checks.
- Keep code comments about the code itself.
- The Playwright image tag in the Dockerfile `e2e` stage must match the `@playwright/test`
  version in `package.json`. Dependabot proposes the two updates separately, so merge them
  together.

## License

Licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md).
