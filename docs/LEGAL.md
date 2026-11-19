# Legal

All license, copyright and attribution information for this project lives in
this file. Source files intentionally carry no license headers.

## Project license (MIT)

Copyright (c) 2015 Otto Seiskari
Copyright (c) 2026 Adriwin

Based on [oseiskar/black-hole](https://github.com/oseiskar/black-hole) by Otto
Seiskari, as substantially extended by
[Adriwin06/black-hole](https://github.com/Adriwin06/black-hole).

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The MIT license applies to the first-party source code. Bundled third-party
libraries and assets keep their own licenses, listed below.

## Third-party libraries

These libraries are served from `public/vendor/` and shipped with every build. `OrbitControls.js`
carries project modifications (pan/zoom callbacks and roll).

| Component                                                             | Location                                                        | License           |
| --------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------- |
| [dat.GUI](https://github.com/dataarts/dat.gui)                        | `public/vendor/dat.gui.min.js`                                  | Apache-2.0        |
| [jQuery](https://jquery.org)                                          | `public/vendor/jquery-2.1.4.min.js`                             | MIT               |
| [three.js](https://threejs.org) (+ `Detector.js`, `OrbitControls.js`) | `public/vendor/three.min.js`, `Detector.js`, `OrbitControls.js` | MIT               |
| [stats.js](https://github.com/mrdoob/stats.js)                        | `public/vendor/stats.min.js`                                    | MIT               |
| [mustache.js](https://github.com/janl/mustache.js)                    | `public/vendor/mustache.min.js`                                 | MIT               |
| [webm-muxer](https://github.com/Vanilagy/webm-muxer)                  | `public/vendor/webm-muxer.js`                                   | MIT               |
| Font Awesome 4.5 CSS (loaded from a CDN at runtime, not bundled)      | —                                                               | SIL OFL 1.1 / MIT |

`public/vendor/three-js-monkey-patch.js` is first-party code covered by the project license.

## Build and test tooling

Vite, Vitest, ESLint, Prettier, Playwright and the Docker base images are used only to build and
test the project; none of their code is included in the published site. The production container
image (the `runtime` Dockerfile stage) redistributes nginx (BSD-2-Clause) and Alpine Linux
packages under their respective licenses.

## Assets

| Asset                                                 | Source                                                                                                            | License                                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `public/textures/milkyway.jpg`                        | [Stellarium](https://www.stellarium.org/), based on Nick Risinger's [Photopic Sky Survey](https://skysurvey.org/) | [CC BY-NC 2.0](https://creativecommons.org/licenses/by-nc/2.0/) — **not** MIT |
| Other files in `public/textures/` and `public/icons/` | Upstream projects listed above                                                                                    | MIT                                                                           |
