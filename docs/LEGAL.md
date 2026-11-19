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

The build bundles these npm packages into the published site at the versions recorded in
`package-lock.json`. Minification strips their license comments, so their notices are kept here.

| Package                                                        | Version | Used for                                                                                 | License |
| -------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------- | ------- |
| [three.js](https://threejs.org) (`three`)                      | 0.187.0 | WebGL 2 renderer, plus `OrbitControls`, `FullScreenQuad` and the stats panel from addons | MIT     |
| [lil-gui](https://github.com/georgealways/lil-gui)             | 0.21.0  | Settings panel                                                                           | MIT     |
| [mustache.js](https://github.com/janl/mustache.js)             | 4.2.0   | Shader source templates                                                                  | MIT     |
| [Mediabunny](https://mediabunny.dev)                           | 1.66.1  | MP4 and WebM encoding and muxing for offline recordings                                  | MPL-2.0 |
| [Workbox](https://developer.chrome.com/docs/workbox)           | 7.4.1   | Service worker runtime and its registration, see below                                   | MIT     |
| [vite-plugin-pwa](https://github.com/vite-pwa/vite-plugin-pwa) | 2.0.0   | Service worker registration module `virtual:pwa-register`                                | MIT     |

The service worker files `sw.js` and `workbox-[hash].js` contain the Workbox modules
`workbox-core`, `workbox-precaching`, `workbox-routing`, `workbox-strategies`, `workbox-expiration`
and `workbox-cacheable-response`, bundled by `workbox-build`. `workbox-window` is the chunk
`assets/workbox-window.prod.es5-[hash].js`, and the entry chunk contains vite-plugin-pwa's
registration module.

### MIT-licensed packages

three.js, lil-gui, mustache.js, Workbox and vite-plugin-pwa are distributed under the MIT License.
Its text is the permission notice in the project license section above, which applies to each
package with that package's copyright notice in place of the project's:

- three.js: Copyright © 2010-2026 three.js authors
- lil-gui: Copyright (c) 2019 George Michael Brower
- mustache.js: Copyright (c) 2009 Chris Wanstrath (Ruby); Copyright (c) 2010-2014 Jan Lehnardt
  (JavaScript); Copyright (c) 2010-2015 The mustache.js community
- Workbox (every `workbox-*` package above): Copyright 2018 Google LLC
- vite-plugin-pwa: Copyright (c) 2020-PRESENT Anthony Fu

### Mediabunny (MPL-2.0)

Copyright (c) 2026-present, Vanilagy and contributors.

Mediabunny is subject to the terms of the [Mozilla Public License, v. 2.0](https://mozilla.org/MPL/2.0/).
It is bundled unmodified into the chunk `assets/offline-video-encoder-[hash].js`, which the
browser loads only when an offline recording starts. The Mediabunny code in that chunk stays under
the MPL-2.0; the license does not extend to the rest of this project. The Source Code Form is
available from the [`v1.66.1` tag](https://github.com/Vanilagy/mediabunny/tree/v1.66.1) of the
upstream repository and from the
[`mediabunny@1.66.1`](https://www.npmjs.com/package/mediabunny/v/1.66.1) npm package. Its two
dependencies, `@types/dom-mediacapture-transform` and `@types/dom-webcodecs` (MIT, Copyright (c)
Microsoft Corporation), contain only TypeScript declarations and are not part of the bundle.

### Build helpers in the bundle

Vite adds its dynamic-import preload helper to the entry chunk and Rolldown adds its module runtime
helpers as a chunk of their own. Both are MIT-licensed, under the permission notice in the project
license section:

- Vite: Copyright (c) 2019-present, VoidZero Inc. and Vite contributors
- Rolldown: Copyright (c) 2024-present VoidZero Inc. & Contributors

## Icons

The link-bar icons in `index.html` are SVG paths copied from [Lucide](https://lucide.dev)
(`lucide-static` 1.76.0): `circle-question-mark`, `code-xml`, `sigma` and `copyright`. Lucide lists
`circle-question-mark` (formerly `help-circle`) among its icons derived from
[Feather](https://feathericons.com), which is MIT-licensed, Copyright (c) 2013-present Cole Bemis,
under the permission notice in the project license section. Lucide itself is ISC-licensed:

```text
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

## Build and test tooling

Vite (apart from the helpers above), vite-plugin-pwa and `workbox-build` (apart from the service
worker code above), Vitest, ESLint, Prettier, Playwright, the Docker base images and
[jpeg-js](https://github.com/jpeg-js/jpeg-js) (BSD-3-Clause, used by `scripts/build-sky.js` to
convert the sky map) are used only to build and test the project; none of their code is included
in the published site. The production container image (the `runtime` Dockerfile stage)
redistributes nginx (BSD-2-Clause) and Alpine Linux packages under their respective licenses.

## Assets

| Asset                                                                   | Source                                                                                                                                                                                                                                               | License                                                                                                                                    |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `public/textures/sky/`                                                  | [Deep Star Maps](https://svs.gsfc.nasa.gov/3895) (ID 3895, 2012), NASA/Goddard Space Flight Center Scientific Visualization Studio; visualization by Ernie Wright from the Bright Star, Tycho-2 and UCAC3 catalogues. Source file: `starmap_g8k.jpg` | Public domain ([SVS usage policy](https://svs.gsfc.nasa.gov/help/): "All of our content is in the public domain (unless otherwise noted)") |
| `public/icons/black-hole.svg` and the other files in `public/textures/` | The upstream black-hole projects named in the project license section                                                                                                                                                                                | MIT                                                                                                                                        |
| `public/icons/*.png`                                                    | Rendered from `public/icons/black-hole.svg` by `scripts/render-pwa-icons.js`                                                                                                                                                                         | MIT, as their source                                                                                                                       |
| `public/og-image.jpg`                                                   | Rendered by this project's ray tracer (`scripts/render-og-image.js`)                                                                                                                                                                                 | MIT; it shows only the public-domain sky map and MIT-licensed textures                                                                     |

The sky faces are modified from the source: `scripts/build-sky.js` reprojects the galactic plate
carrée to cube-map faces, resamples them to 2048, 1024 and 512 px and recompresses them as JPEG.

The blackbody and synchrotron colour table `src/app/core/physics/emission-lut.json` is generated
in this repository by `scripts/generate-emission-lut.js` from the CIE 1931 colour-matching
function fit of Wyman, Sloan and Shirley (2013) and carries no third-party rights. It replaces the
former `spectra.png`; the procedural `stars.png` was removed because the sky map contains the
real star field.

The Scientific tone mapper uses matplotlib's Inferno colour map by Stéfan van der Walt and
Nathaniel Smith, whose data in the [BIDS colormap repository](https://github.com/BIDS/colormap) is
dedicated to the public domain under CC0 1.0. `src/app/graphics/output-pass.js` evaluates it, in
the shader and in the on-screen colour bar, with the polynomial coefficients fitted to that data
in [Shadertoy WlfXRN](https://www.shadertoy.com/view/WlfXRN), which are also published under
CC0 1.0.
