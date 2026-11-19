# Physics of the renderer

Development notes on how the ray tracer models light near a black hole: the units, the two
geodesic solvers, the camera frames, the frequency shifts applied to every emitter, the emission
models and the imaging pipeline, and how the results are validated. Equations are written in the
shader's units unless stated otherwise.

## Units and conventions

- Lengths are measured in Schwarzschild radii, `r_s = 2M = 1`, so `M = 1/2` (`KERR_M`,
  `SHADER_MASS`). The dimensionless spin `a/M` is the `spin` control; the shader uses
  `a = spin * M`, signed, with the spin axis along `+z`.
- Signature `(-, +, +, +)`, `G = c = 1`.
- `g = nu_obs / nu_emit` is the frequency ratio of a ray. The shader mostly works with its
  inverse, the transfer factor `nu_emit / nu_camera`: temperatures are divided by it and, with
  physical beaming, intensities by its cube (Liouville, `I_nu / nu^3` is invariant).
- Rays are traced backwards from the camera. The backward covector is `p = -k`, where `k` is the
  physical photon momentum, so `p_t = E` is the photon energy at infinity.

## Solvers

The `Solver` control (`kerr_mode`) selects one of three modes:

| Mode                          | Geodesics                                                       | Use                                            |
| ----------------------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| Fast (Binet lensing)          | Schwarzschild Binet equation, heuristic spin lensing            | cheapest; exact for `a = 0`                    |
| Kerr-inspired disk velocities | Same Binet photons, Kerr ISCO and Keplerian disk velocities     | default of mobile, optimal and medium          |
| Full Kerr                     | Null geodesics of the Kerr metric, adaptive Dormand-Prince 5(4) | default of high, ultra and cinematic, `a != 0` |

Selecting a quality preset applies its default solver: high, ultra and cinematic switch a
spinning hole to Full Kerr, the other presets (and every preset at `a = 0`, where the Binet
solver is exact and cheaper) use the Kerr-inspired mode. An explicit choice of the fast mode is
kept, and Full Kerr can be chosen by hand at every preset, which then applies its Full Kerr
tier (table below).

### Binet solver

For a Schwarzschild photon in its orbital plane, `u = 1/r` obeys

    d^2u/dphi^2 = -u + (3/2) u^2        (r_s = 1)

with the first integral `(du/dphi)^2 + u^2 - u^3 = 1/b^2`. The shader integrates it with RK4 or
leapfrog in steps of `phi`, rebuilding the 3-D position in the plane spanned by the radial
direction and the tangential part of the ray. The spin modes add a frame-dragging rotation of
that plane and a perturbative term to the acceleration; these heuristics are switched off during
hover and dive, whose escape classification is analytic and exact for Schwarzschild.

Inside the photon sphere (`u > 2/3`) the escape test is analytic: a backward ray escapes only if
it starts outward (`du < 0`) and `(du/dphi)^2 + u^2 - u^3 > 4/27`, i.e. `b < b_c = 3 sqrt(3) M`.

### Full Kerr solver

**Metric.** The Kerr metric in Cartesian Kerr-Schild (CKS) coordinates is

    g_mn = eta_mn + f l_m l_n,        f = 2 M r^3 / (r^4 + a^2 z^2),
    l_m = (1, (r x + a y)/(r^2 + a^2), (r y - a x)/(r^2 + a^2), z/r),

with the Kerr-Schild radius `r` (equal to the Boyer-Lindquist `r`) given by

    r^4 - (x^2 + y^2 + z^2 - a^2) r^2 - a^2 z^2 = 0,
    r^2 = (w + sqrt(w^2 + 4 a^2 z^2)) / 2,   w = x^2 + y^2 + z^2 - a^2.

For `w < 0` the shader uses the equivalent `r^2 = 2 a^2 z^2 / (sqrt(w^2 + 4 a^2 z^2) - w)` to
avoid cancellation in float32. The coordinates are regular across the future horizon, so the
same equations carry cameras through it, and they are asymptotically Cartesian, so the spatial
direction of the momentum at large `r` is the position on the sky.

**Hamiltonian.** With `g^mn = eta^mn - f l^m l^n` and `(l.p) = -p_t + l.p_vec`,
`H = (1/2) g^mn p_m p_n = 0` gives

    dx/dlambda = p - f (l.p) l,          dt/dlambda = -p_t + f (l.p),
    dp/dlambda = (1/2) (l.p)^2 grad f + f (l.p) (grad l).p.

`p_t` and `p_phi = x p_y - y p_x` are conserved. The gradients follow from implicit
differentiation of the radius equation, with `D = r^4 + a^2 z^2`:

    grad r = (r^3 x, r^3 y, r (r^2 + a^2) z) / D,
    grad f = f [ (3/r - 4 r^3/D) grad r - (2 a^2 z / D) e_z ],
    (d_j l).p = A_j + B d_j r,
    A = ((r p_x - a p_y)/(r^2 + a^2), (a p_x + r p_y)/(r^2 + a^2), p_z / r),
    B = [p_x (x - 2 r l_x) + p_y (y - 2 r l_y)] / (r^2 + a^2) - p_z z / r^2.

**Integrator.** Dormand-Prince 5(4) with first-same-as-last stages (six right-hand-side
evaluations per step) and the error norm

    err = h max( |e_x| / (atol + rtol max(|x_n|, |x_n+1|)), |e_p| / (atol + rtol max(|p|, |p_t|)) ),

`atol = 1e-6`. A step is accepted for `err <= 1`; the next step is `h * clamp(0.9 err^(-1/5),
0.2, 5)` (Hairer, Norsett & Wanner). On top of the error control the step is capped so that it
sweeps at most about 0.2 rad of azimuth (`h <= 0.2 r^2 / |x cross dx/dlambda|`), moves at most
`2 r` (so `r` at most triples), closes at most half of the remaining gap to the horizon while
falling in (`h <= 0.5 (r - r_+) / |dr/dlambda|`), and samples volumetric emitters every `0.06 r`
within `max(40, 1.2 jet_length)`. Each quality preset sets `rtol` and the iteration budget, in
which a rejected trial also counts:

| Preset    | rtol | iterations | samples |
| --------- | ---- | ---------- | ------- |
| mobile    | 1e-3 | 96         | 1       |
| optimal   | 3e-4 | 160        | 1       |
| medium    | 1e-4 | 256        | 3       |
| high      | 1e-4 | 384        | 4       |
| ultra     | 1e-5 | 768        | 6       |
| cinematic | 1e-5 | 1024       | 12      |

**Termination.**

- Capture: `dr/dlambda < 0` and `r < 1.01 r_+`, `r_+ = M + sqrt(M^2 - a^2)`. Backward rays that
  fall onto the hole pile up against the past horizon, which ingoing Kerr-Schild coordinates
  only reach asymptotically, so they are cut just outside it.
- Escape: `dr/dlambda > 0` and `r > max(500, 4 r_camera)`; the remaining deflection is of order
  `r_s / r`. The sky is sampled along `dx/dlambda`.
- Out of iterations: rays beyond `r = 10` that are receding go to the sky, others stay dark.
- Cameras inside the horizon: every backward ray moves outward and leaves through the future
  horizon, which a photon can cross inward only if `p.(d_t + Omega_H d_phi) >= 0`,
  `Omega_H = a / (r_+^2 + a^2)`. Rays violating this came from the white-hole region and are
  dark from the start.

**Emitters.** Emission code is shared with the Binet solver. It receives a Boyer-Lindquist-like
point `(x, y) r / sqrt(r^2 + a^2), z` whose length is `r` and whose height is `r cos(theta)`. The
thin disk crossing is located on the cubic Hermite interpolant of the step, built from the end
points and their derivatives, and its radius is `sqrt(x^2 + y^2 - a^2)` on the equator.

**Light travel time.** The Kerr-Schild time `t` is integrated with the ray; emitters are sampled
at the retarded time `t_camera - Delta t`.

## Camera frames

The CPU (`src/app/core/physics/kerr-camera.js`, float64) builds the 4-velocity of the physical
camera and an orthonormal tetrad `(u, e1, e2, e3)` whose spatial legs follow the camera's right,
up and forward axes (Gram-Schmidt in the metric, forward first). The camera position is the CKS
point at Boyer-Lindquist radius `|position|` in the direction of `position`. Per pixel the shader
forms the backward covector

    p_mu = -u_mu + d^i e_i,mu,

so the traced observer measures unit frequency for the look direction `d`, and the physical
camera measures `nu_cam = c_0 + c . d`, where `c` are its 4-velocity components in the tetrad.
Every transfer factor is divided by `nu_cam`.

| Camera                    | Observer                                                                 |
| ------------------------- | ------------------------------------------------------------------------ |
| Free camera, hover        | static, `u = d_t / sqrt(1 - f)`, outside the ergosurface                 |
| Orbit                     | ZAMO boosted along the motion with `v = varpi (Omega_K - omega) / alpha` |
| Dive (outside and inside) | Doran rain observer                                                      |

- Static observers exist for `f < 1`; the hover stops at `1.0002 r_s`, outside the ergosurface
  for every spin, and its readout uses the Kerr clock rate `sqrt(1 - f)` and proper acceleration
  `|grad ln sqrt(1 - f)|`. Elsewhere inside the ergosphere the zero-angular-momentum observer
  (ZAMO) with `omega = 2 M a r / A`, `A = (r^2 + a^2)^2 - a^2 Delta sin^2(theta)`, replaces it.
- Circular equatorial orbits have `Omega_K = s sqrt(M) / (r^(3/2) + s a sqrt(M))`, `s = +-1`.
- The Doran (2000) rain observer falls from rest at infinity with zero angular momentum and
  zero Carter constant, so `theta` stays constant:

        U_r = -sqrt(2 M r) / (sqrt(r^2 + a^2) + sqrt(2 M r)),
        u^t = 1 + f (1 + U_r),   u^i = U_r d_i r - f (1 + U_r) l_i,
        dr/dtau = -sqrt(2 M r (r^2 + a^2)) / rho^2.

  The dive integrates `dr/dtau` and stops at `1.05 r_-` for `a != 0`, above the inner (Cauchy)
  horizon.

- The aberration strength blends the traced observer from the reference observer (static or
  ZAMO, strength 0) to the physical camera (strength 1) by scaling their relative speed; the
  frequency normalisation still uses the physical camera. With aberration off the reference
  observer is traced.

## Frequency shifts

For gas on the stationary orbit `d_t + Omega d_phi` through `(r, theta)`,

    p.u = u^t (p_t + Omega p_phi),
    (u^t)^-2 = 1 - Omega^2 (r^2 + a^2) sin^2(theta) - f (1 - Omega a sin^2(theta))^2,
    f = 2 M r / (r^2 + a^2 cos^2(theta)),

and the transfer factor is `p.u / nu_cam`, exact for any spin because `p_t` and `p_phi` are
conserved along the ray. Where the orbit is not timelike (inside the photon orbit or the
ergosphere) the ZAMO stands in.

| Emitter     | Velocity field in Full Kerr                                                     |
| ----------- | ------------------------------------------------------------------------------- |
| Thin disk   | `Omega_K(r)`, co-rotating with the hole                                         |
| Thick torus | `0.5 Omega_K(r sin(theta))` at the sample point                                 |
| Slim disk   | `Omega_K(r sin(theta))` at the sample point                                     |
| Jets        | ZAMO frame (exact) times the jet's own Doppler factor along the chord direction |
| Planet      | ZAMO frame at the planet's orbit times the planet's own Doppler factor          |
| Sky         | `nu_infinity / nu_cam = p_t / nu_cam`                                           |

In Full Kerr the gravitational shift is part of `p.u`, so `gravitational_shift_static()` returns
1 and the physical-beaming factor `transfer^-3` includes it. The Binet modes split the shift into
the static gravitational factor `sqrt(1 - r_s/r_emit) / sqrt(1 - r_s/r_camera)`, which shifts the
temperature only, and the kinematic factor, which also scales the intensity.

## Binet observer frames

The Binet modes describe the camera relative to one of two reference observers.

- Static frame (free camera, orbit, hover): `nu_static / nu_camera = gamma (1 - d . v)` with the
  direction `d` seen by the camera, aberration by a Lorentz transformation of `d`, and the Binet
  start `du/dphi = -u sqrt(1 - r_s/r) d_r / d_t`, where the lapse converts the orthonormal radial
  component into Schwarzschild `r`. The background is shifted by
  `grav_blueshift_factor = sqrt(1 - r_s/r_camera)`.
- Rain frame (dive, on both sides of the horizon): with `beta = sqrt(r_s / r)` the photon energy
  per camera frequency is `E = 1 + beta d_r`, `du/dphi = -u (d_r + beta) / d_t`, and the sky
  shift is `1 / (1 + beta d_r)` with `grav_blueshift_factor = 1`. Inside the horizon rays with
  `E <= 0` are dark.

Static-observer escape cones are a useful check: at `r = 1.5, 1.2, 1.1 r_s` the sky fills a cone
of half-angle `90, 62.1, 45.4` degrees around the outward direction.

## Emission

Every emitter turns its frequency ratio `g` into colour and brightness by the same rule, so the
disk, the volumes, the planet and the sky stay consistent under any shift.

### Blackbody colour and luminance

Colours come from the CIE 1931 2-degree colour-matching functions in the multi-lobe Gaussian fit
of Wyman, Sloan and Shirley (2013). For a Planck spectrum `B_lambda(T)`,

    X = int B_lambda(T) xbar(lambda) dlambda,   Y, Z likewise,
    L_v = K_m Y,   K_m = 683 lm/W,

and the linear Rec. 709 (sRGB) colour is `M_XYZ->sRGB (X, Y, Z)` with the IEC 61966-2-1 matrix.
`scripts/generate-emission-lut.js` writes `emission-lut.json`: row 0 holds the unit-luminance
colour and `log10 L_v` (cd/m^2) at 512 temperatures spaced in `ln T` from 500 K to 1e6 K, and
continues above 1e6 K with the Rayleigh-Jeans law `L_v ~ T`. Row 1 holds the colour of an
optically thin power law `F_nu ~ nu^-alpha` for `alpha` in `[-1, 3]`.

Since `I_nu / nu^3` is invariant, a blackbody of temperature `T` seen with ratio `g` is a
blackbody of temperature `g T`: its colour is the chromaticity at `g T` and its luminance
`L_v(g T)`, not `g^3` or `g^4` times the rest value, because the visible band slides along the
spectrum. A colour-corrected photosphere (Shimura and Takahara 1995) radiates
`f_col^-4 B_nu(f_col T)`, so it looks like a blackbody at `f_col g T` dimmed by `f_col^4`. The
bolometric model replaces `L_v(g T)` by the efficacy-weighted `sigma (g T)^4 / pi`. The doppler
and beaming switches set the colour and brightness ratios to 1, which removes the gravitational
part of `g` as well.

### Thin disk

The Novikov-Thorne disk with the Page and Thorne (1974) flux, with `x = sqrt(r / M)`,
`x_0 = sqrt(r_isco / M)` and the spin `a` in units of `M`:

    F(r) = 3 Mdot / (8 pi M^2 x^4 (x^3 - 3x + 2a))
           * [ x - x_0 - (3a/2) ln(x/x_0)
               - sum_i 3 (x_i - a)^2 / (x_i (x_i - x_j)(x_i - x_k)) ln((x - x_i)/(x_0 - x_i)) ],

where `x_i` are the roots of `x^3 - 3x + 2a = 0`; far out it tends to the Newtonian
`3 M Mdot / (8 pi r^3)`. The shader receives the spin-only terms and evaluates the bracket with
four logarithms per hit. The effective temperature is `T(r) = T_peak (F / F_max)^(1/4)`.

- Artist scales set `T_peak` directly, or (uniform) put the whole disk at that temperature.
- The physical scale uses `Mdot = l L_Edd / (eta c^2)` with `L_Edd = 4 pi G M m_p c / sigma_T`
  and `eta = 1 - E_isco`, so `T_peak ~ M^-1/4`: 1e4-1e5 K around supermassive holes and
  1e6-1e7 K around stellar-mass ones, both blue-white in the visible.
- With GRMHD on, a stress term `K x_0` in the bracket lets the disk emit at the ISCO, and the
  flux continues inward as `(r / r_isco)^1.5` over the plunging region.
- Limb darkening `L(mu) = c_0 + c_1 mu`, normalised to `2 int L mu dmu = 1`: Chandrasekhar's
  electron-scattering law (`c_1 / c_0 = 2.06`), Eddington's (`0.5 + 0.75 mu`) or isotropic, with
  `mu` measured in the fluid frame.
- The gas moves on prograde circular Kerr orbits, `Omega = 1 / (r^1.5 + a)`, so
  `g = 1 / (u^t (E - Omega L_z))` for a photon of energy `E` and axial angular momentum `L_z`
  per camera frequency. Inside the ISCO it plunges with the ISCO energy and angular momentum
  (Cunningham 1975), which adds `-p_r u^r` to the emitted frequency.

### Synchrotron jets

Jets radiate an optically thin power law. A Doppler shift leaves its colour unchanged and scales
the specific intensity at a fixed observed frequency by `g^(3 + alpha)`; integrating the
fluid-frame path `dl / g` of a steady flow leaves `g^(2 + alpha)` (Lind and Blandford 1985).
For bulk speed `beta` and Lorentz factor `Gamma` at angle `theta` to the line of sight the
kinematic part is `delta = 1 / (Gamma (1 - beta cos(theta)))`, so a `Gamma = 15` jet seen at
4 degrees is boosted by `delta = 14.3` and its counter-jet dimmed by `delta = 0.033`.

### Sky

The background is a procedural spiral galaxy and a field of distant stars, drawn as particles
seen from the hole into a cube map (`src/app/sky/`, reference model `src/features/galaxy/model.js`).
The galaxy is so far away in units of `r_s` that the cube sits at infinity: an escaping ray shows
the sky along its asymptotic direction. Disk stars and dust clouds follow webgpu-galaxy
(Greenheck 2025): radius `sqrt(u) R` with `R = 13` units, one of `m` arms whose angle grows
linearly with radius, scatter about the arm ridge that also sets the colour, a thickness tapering
outwards, and the rotation law `Omega(r) = s / (1 + 0.1 r)`, whose speed flattens beyond the core.
A flattened Plummer bulge (Plummer 1911; scale `0.11 R`, axis ratio 0.6, cut at four scale radii)
holds a share of the stars. Field stars lie uniformly on the sphere with Euclidean counts
`N(>F) ~ F^-3/2`, normalised so the bright end does not depend on their number, and blackbody
colours from 2600 to 25 000 K.

No particle is stored or integrated: each is a function of its index (the integer hash lowbias32,
identical in JavaScript and GLSL) and of the pattern phase `Phi = Omega_p t`, where `t` is the
observer's coordinate time. The galaxy therefore turns faster while the observer's clock runs slow
near the hole, stops with the clock, and seeks and offline renders are deterministic. In winding
mode every star keeps its orbit, `theta = theta_0 - Omega(r) t`, as in webgpu-galaxy, and
differential rotation winds the arms up within a few turns (the winding problem, Binney and
Tremaine 2008, section 6.1). The default density-wave mode keeps the arms: the pattern turns
rigidly at the angular speed `Omega_p` of the corotation radius, and young stars and clouds are
born on it and drift at `Omega(r) - Omega_p` for one lifetime, a fraction of a pattern turn, with
the brightness envelope `smoothstep(0, 0.06, a) (1 - a)^2` over their age `a` (quasi-stationary
spiral structure, Lin and Shu 1964). The phase terms are reduced modulo `2 pi` and modulo a
lifetime in double precision before they reach the shader, so they stay exact at any time.

Each particle stands for a star cloud of fixed size. Its sprite keeps the light of the particle's
solid angle down to 2 px, where brightness replaces size, and stops growing at 4 px; above
0.012 rad the light grows more slowly than the solid angle, so from inside the galaxy the nearest
particles stay bright stars instead of washing out the sky. Particle brightness scales inversely
with the particle count, so every quality preset (384 to 2048 px faces, 60 000 to 1 000 000
stars) shows the same total light. The cube is R11G11B10F (RGBA16F or RGBA8 without float colour
buffers) with mipmaps. It is rendered again when a parameter changes, and while the galaxy turns
only the faces its bounding sphere reaches, once the fastest particle could have moved 0.35
texel; a revision uniform tells still accumulation that the sky changed. The scenarios place the
hole outside its galaxy, at the centre (Sgr A*) or in the disk at 0.62 `R` (stellar-mass holes).
The grid sky instead draws lines of latitude and longitude every 15 degrees about the spin axis on
a dim base, widened by the pixel footprint and faded to their mean coverage once the footprint
spans a grid cell.

The ray tracer samples the sky with `textureGrad`, using the screen-space
derivatives of the escape direction taken in uniform control flow, so the strongly minified and
sheared sky near the photon ring reads pre-filtered mip levels with anisotropic taps. Where a
2x2 pixel quad straddles a capture boundary, or the direction changes by more than 1 rad between
neighbours (a caustic), the derivatives are meaningless and the lookup falls back to level 0. A
texel is treated as a blackbody at its correlated colour temperature (McCamy 1992), so the sky
shifts like every other emitter.

## Imaging

    trace (RGBA16F, pre-exposed linear Rec. 709) -> temporal resolve -> bloom
        -> white balance -> tone mapping -> sRGB OETF + dither -> canvas

### Exposure

The trace multiplies every radiance by the pre-exposure `H` and clamps it to `[0, 6e4]` below the
half-float limit, so the HDR target never holds infinities. In the anchored mode the face-on
luminance `Y_ref` of the reference emitter (the disk at `T_peak`) lands at `0.5 2^EV`:
`H = 0.5 2^EV / Y_ref`, which keeps the image level when the temperature or radiance model
changes. The manual mode is the photometric camera `H = 1 / (1.2 2^EV100)` (Lagarde and de
Rousiers 2014), in which a 4500 K disk and a 1e7 K disk differ by many stops, as they should.

### Temporal resolve and accumulation

Each frame is jittered by a Halton(2, 3) sub-pixel offset. While the view changes, the
neighbourhood of the new frame clips the history before the blend (Karis 2014; Salvi 2016): in
YCoCg on `c / (1 + Y)`, which keeps single HDR fireflies from dominating, the history is pulled
towards the 3x3 mean `mu` into the box `mu +- gamma sigma`, then blended with weight `w`.

While every ray-tracer input stays the same (camera, clock, settings), the history instead
becomes the running mean `m_n = m_(n-1) + (x_n - m_(n-1)) / n` of frames jittered along the
unbounded Halton sequence, which converges to the box-filtered pixel integral. A valid TAA
history seeds it with the `1 / (1 - w)` frames it holds. After `max_frames` frames the trace
stops and the mean is shown.

### Bloom

The glare follows the dual-filter chain of Call of Duty: Advanced Warfare (Jimenez 2014): a
13-tap downsample with a Karis average on the first level against fireflies, then 3x3 tent
upsampling with `U_i = (1 - r) D_i + r tent(U_(i+1))`. Level `i` therefore enters with weight
`(1 - r) r^i`, and the weights sum to one. The composite `(1 - k) scene + k bloom` moves energy
instead of adding it, so the mean brightness of the frame does not change with the strength `k`.

### White balance

An optional camera white point adapts a blackbody white at `T_wb` to D65 with the Bradford
transform (Lindbloom):

    M = M_XYZ->sRGB  B^-1  diag(rho_D65 / rho_wb)  B  M_sRGB->XYZ,

applied to the linear frame before tone mapping. A blackbody at `T_wb` comes out neutral.

### Tone mapping and output

| Mode       | Curve                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------- |
| AgX        | Sobotka's AgX (the three.js reference), the default; desaturates highlights towards white |
| Neutral    | Khronos PBR Neutral: nearly linear up to 0.76, then a hue-preserving shoulder             |
| ACES       | ACES filmic RRT + ODT fit (three.js `ACESFilmicToneMapping`)                              |
| Scientific | Inferno colour map on `log2 Y` over 12 stops ending 3 stops above the anchor; no OETF     |

Inferno (van der Walt and Smith 2015) is perceptually uniform, monotonic in lightness and
readable with the common colour-vision deficiencies, so the Scientific mode doubles as a
colour-blind-safe false-colour luminance map. Its colour bar labels the window in cd/m^2 at whole
decades: the traced value is luminance times the pre-exposure, so the window ends at
`L_max = 0.5 2^3 / H`, which follows both exposure modes. The display modes end with the sRGB OETF
(IEC 61966-2-1), and every mode adds triangular-PDF dither of one 8-bit step from a per-frame
hash before quantisation, which removes banding in the dark sky and the bloom gradients.

## Presets

| Preset                    | Scale    | Parameters                                                                      |
| ------------------------- | -------- | ------------------------------------------------------------------------------- |
| Cygnus X-1                | physical | 21.2 M_sun, a = 0.998, 0.02 L_Edd, f_col 1.7: T_peak 6.1e6 K                    |
| GRS 1915+105              | physical | 12.4 M_sun, a = 0.98, 0.3 L_Edd: T_peak 1.1e7 K; jets beta 0.92 at 70 degrees   |
| 3C 273                    | physical | 2.6e8 M_sun, a = 0.9, 0.3 L_Edd: T_peak 1.3e5 K; jet Gamma 15, alpha 0.7        |
| TON 618                   | physical | 4.07e10 M_sun, a = 0.9, 0.3 L_Edd: T_peak 3.6e4 K; no jet                       |
| M87\*                     | artist   | 6.5e9 M_sun, a = 0.9, thick torus, jet Gamma 5, viewed 17 degrees from the axis |
| Sgr A\*                   | artist   | 4.297e6 M_sun, a = 0.5, thick torus                                             |
| Gargantua-style cinematic | artist   | a = 0.6, uniform 4500 K, no frequency shifts, 6500 K white point, ACES          |

The spins of 3C 273 and TON 618 are unmeasured and their accretion rates illustrative. The quoted
4-degree viewing angle of the 3C 273 jet assumes a distant observer; from a camera about 11 r_s
out that line of sight runs inside the jet, so the preset views it from 12 degrees
(`delta = 2.8`).

## Validation

- `tests/unit/kerr.test.js` checks the horizon, ISCO, photon-orbit and marginally bound radii
  (Bardeen, Press & Teukolsky 1972), 4-velocity normalisation of every observer, clock rates and
  speeds against published values, tetrad orthonormality, the static-observer shadow angle and
  the Bardeen critical curve.
- `tests/unit/kerr-geodesic.test.js` runs a float64 mirror of the shader integrator: the
  right-hand side equals the gradient of `H` (finite differences), `H` and `p_phi` are conserved
  to `1e-7`, the `a = 0` capture threshold is `b_c = 3 sqrt(3) M` within 0.5 %, and equatorial
  and polar capture match the Bardeen curve for `a/M = 0.5, 0.9, 0.998`.
- `tests/e2e/shadow.spec.js` renders the free camera, a static observer looking at the hole,
  with one ray per pixel against the grid sky at a gain that saturates even its dim base, so a
  pixel is bright exactly when its ray escapes. Each view is rendered at four camera azimuths
  about the spin axis and a pixel counts as captured only when it is dark in all of them. The
  radius in each angular sector follows from the area its captured pixels cover, which averages
  the edge over the sector: a stray ray that escapes just inside the edge moves it by hundredths
  of a pixel, and the radius resolves to about a pixel.
  - `a = 0`, both solvers, `r = 5` and `11 r_s`: the angular radius in 16 sectors matches
    `sin(psi) = (3 sqrt(3)/2)(r_s/r) sqrt(1 - r_s/r)` (Synge 1966) within 1 %, or 1.5 px where
    that is more (about 1.6 % at `r = 11 r_s` in the 800 px test view). Measured: Kerr-inspired
    (Binet) -0.2 to -0.5 % at `r = 5 r_s` and +0.1 to -1.2 % at `r = 11 r_s`, Full Kerr 0 to
    -0.3 % and +0.3 to -1.2 %. The low value is the top sector in both solvers: the top pixel row
    of the shadow renders as escaping, an effect tied to the screen that stays at the top when the
    camera is rolled upside down.
  - `a/M = 0.9`, Full Kerr, `r = 30 r_s`, inclination 87 degrees: the flattened prograde edge
    and the far retrograde edge, converted to impact parameters with
    `b = r sin(psi) / sqrt(1 - r_s/r)`, match the Bardeen curve within 3 % of its width.
    Measured: 2.2 % and 0.6 %, part of which is the `g_t_phi / g_tt ~ 0.03 M` shift of a static
    observer at that distance.
- `tests/unit/colorimetry.test.js`: the blackbody chromaticity table and CIE illuminant A within
  the error of the colour-matching fit, band luminance `Y(g T) / Y(T)` instead of `g^3`, the
  luminous efficacy of a D65-white blackbody, the committed LUT equal to the generator output,
  unit-luminance in-gamut entries, log-T interpolation and the Rayleigh-Jeans continuation,
  power-law colours, and white balance that renders the chosen blackbody neutral.
- `tests/unit/thin-disk.test.js`: Page-Thorne flux maxima at the published radii, the flux at
  twice the ISCO radius, zero flux at the ISCO and the Newtonian limit `3 M Mdot / (8 pi r^3)`,
  `eta = 1 - E_isco`, the physical peak temperatures, the face-on ISCO redshift `1 / u^t`,
  normalised circular and plunging 4-velocities, and `g = 1 / (u^t (E - Omega L_z))`.
- `tests/unit/emission.test.js`: the per-spin bracket coefficients, the bolometric efficacy, the
  `f_col^4` dimming at fixed colour, both exposure modes, the Scientific window in cd/m^2 and an
  Inferno map whose luminance rises monotonically.
- `tests/e2e/accumulation.spec.js`: a static view accumulates up to `max_frames` and restarts
  when the view changes.
- `tests/e2e/scientific-legend.spec.js`: the colour bar appears only with the Scientific tone
  mapper and moves one stop down in luminance per stop of exposure.

## Performance

Measured in headless Chromium with SwiftShader (a CPU rasterizer, so only ratios carry over to
GPUs) at 800 x 450 with the default scene (`a/M = 0.9`, thin disk), milliseconds per frame:

| Preset    | Kerr-inspired | Full Kerr | Ratio |
| --------- | ------------- | --------- | ----- |
| mobile    | 116           | 195       | 1.68  |
| optimal   | 421           | 381       | 0.90  |
| medium    | 800           | 1000      | 1.25  |
| high      | 2000          | 1818      | 0.91  |
| ultra     | 2222          | 2000      | 0.90  |
| cinematic | 2500          | 2222      | 0.89  |

Full Kerr takes fewer, larger steps than the Binet solver's fixed angular grid, which offsets
the six Hamiltonian evaluations per step at the higher presets; it is the default there. The
ratio holds across sample counts: at 400 x 225 with the high tiers, 1, 4 and 12 samples per
pixel cost 313, 833 and 1250 ms with the Kerr-inspired mode and 268, 789 and 1154 ms with Full
Kerr. Shader compilation does not grow either: the time from a shader change to the first frame,
minus that of a uniform-only change, at 160 x 90 was about 20 ms, 430 ms and 1.2 s for Full Kerr
at mobile, high and cinematic against 20 ms, 510 ms and 1.5 s for the Kerr-inspired mode.

### Scene presets

Each scene preset with its own emitters and solver settings at 800 x 450, with still
accumulation tracing every frame, timed as the mean interval between frame completions over 8 s
(mobile) and 30 s (medium) in one session. Absolute SwiftShader times move with the host load,
so compare within a column:

| Scene preset              | mobile (ms) | medium (ms) |
| ------------------------- | ----------- | ----------- |
| Schwarzschild             | 82          | 2492        |
| Default                   | 89          | 2757        |
| Cygnus X-1                | 95          | 3167        |
| Sgr A\*                   | 119         | 3955        |
| Gargantua-style cinematic | 147         | 4001        |
| TON 618                   | 169         | 4674        |
| GRS 1915+105              | 196         | 7394        |
| M87\*                     | 255         | 7192        |
| 3C 273                    | 349         | 8258        |

The ray-marched volumes set the cost: the thick torus (Sgr A\*) and the slim disk (TON 618) add
35 to 90 % to the opaque thin disk, the translucent Gargantua-style disk lets rays continue
through it, and the scenes with jets take two to four times as long as the thin-disk ones.
Measured back to back, the Default scene took 124 and 3581 ms per frame at the commit before the
emission and imaging work and 89 and 2757 ms after it, so the new pipeline as a whole costs less
than the one it replaced. Anisotropic filtering of the sky is about a tenth of the medium time in
SwiftShader (2494 ms without it); GPUs filter in hardware.

## Known limitations

- Brightness in Full Kerr includes the gravitational part of `g^3`; the Binet modes apply only
  the kinematic part to intensity, so a Full Kerr disk is dimmer near the ISCO.
- The camera trajectories (orbit, dive azimuth) still follow Schwarzschild motion in scene
  coordinates; only the local frame is Kerr. The dive keeps a fixed direction, ignoring the
  frame-dragging drift of the rain observer's azimuth.
- Scene axes are read as Kerr-Schild coordinate directions at the camera, which differ from
  Boyer-Lindquist directions by `O(a / r)`.
- Volumetric emitters take the coordinate chord as the path length and the jet Doppler factor
  uses the chord direction in the ZAMO frame.
- Capture at `1.01 r_+` and escape at `500 r_s` bound the sky position error by about
  `r_s / 500` rad; rays out of iterations near the photon orbit are dark.
- The thin disk crossing assumes at most one sign change of `z` per step, which the azimuth cap
  keeps true except for rays grazing the equatorial plane.
- The Binet modes trace Schwarzschild photons for spinning holes; their shadow is the
  Schwarzschild one shifted by the heuristic frame-dragging rotation, not the Bardeen curve.
- The thick torus, slim disk and jets are still emissivity models along the coordinate chord,
  not covariant radiative transfer; there is no 230 GHz (EHT) false-colour mode, broad-line
  region or dusty torus.
- Jet knots are standing reconfinement shocks; moving knots at the retarded time, and with them
  apparent superluminal motion, are not modelled.
- The galaxy is a particle model: its clouds glow and never absorb, so there are no dust lanes,
  and stars are sprites of at least 2 cube texels rather than point sources.
- Exposure is manual or anchored; there is no automatic exposure with adaptation.
- The Scientific colour bar is a page overlay, so recordings and canvas captures leave it out.
- Without float render targets the HDR frame falls back to RGBA8 and clips at 1.

## References

- R. P. Kerr and A. Schild, "Some algebraically degenerate solutions of Einstein's gravitational
  field equations", Proc. Symp. Appl. Math. 17 (1965).
- M. Visser, "The Kerr spacetime: a brief introduction", arXiv:0706.0622 (2007).
- J. M. Bardeen, W. H. Press and S. A. Teukolsky, "Rotating black holes: locally nonrotating
  frames, energy extraction, and scalar synchrotron radiation", ApJ 178, 347 (1972).
- J. M. Bardeen, "Timelike and null geodesics in the Kerr metric", in Black Holes (Les Houches
  1972), Gordon and Breach (1973).
- C. Doran, "A new form of the Kerr solution", Phys. Rev. D 61, 067503 (2000).
- J. R. Dormand and P. J. Prince, "A family of embedded Runge-Kutta formulae", J. Comput. Appl.
  Math. 6, 19 (1980).
- E. Hairer, S. P. Norsett and G. Wanner, Solving Ordinary Differential Equations I, 2nd ed.,
  Springer (1993), sec. II.4.
- J. L. Synge, "The escape of photons from gravitationally intense stars", MNRAS 131, 463 (1966).
- A. J. S. Hamilton and J. P. Lisle, "The river model of black holes", Am. J. Phys. 76, 519
  (2008).
- O. James, E. von Tunzelmann, P. Franklin and K. S. Thorne, "Gravitational lensing by spinning
  black holes in astrophysics, and in the movie Interstellar", Class. Quantum Grav. 32, 065001
  (2015).
- V. Perlick and O. Yu. Tsupko, "Calculating black hole shadows: review of analytical studies",
  Phys. Rep. 947, 1 (2022).
- I. D. Novikov and K. S. Thorne, "Astrophysics of black holes", in Black Holes (Les Houches
  1972), Gordon and Breach (1973).
- D. N. Page and K. S. Thorne, "Disk-accretion onto a black hole. Time-averaged structure of
  accretion disk", ApJ 191, 499 (1974).
- C. T. Cunningham, "The effects of redshifts and focusing on the spectrum of an accretion disk
  around a Kerr black hole", ApJ 202, 788 (1975).
- S. Chandrasekhar, Radiative Transfer, Dover (1960).
- T. Shimura and F. Takahara, "On the spectral hardening factor of the X-ray emission from
  accretion disks in black hole candidates", ApJ 445, 780 (1995).
- C. Wyman, P.-P. Sloan and P. Shirley, "Simple analytic approximations to the CIE XYZ color
  matching functions", JCGT 2(2), 1 (2013).
- C. S. McCamy, "Correlated color temperature as an explicit function of chromaticity
  coordinates", Color Res. Appl. 17, 142 (1992).
- J. C. Lind and R. D. Blandford, "Semidynamical models of radio jets: relativistic beaming and
  source counts", ApJ 295, 358 (1985).
- I. F. Mirabel and L. F. Rodriguez, "A superluminal source in the Galaxy", Nature 371, 46
  (1994).
- D. Greenheck, "webgpu-galaxy", github.com/dgreenheck/webgpu-galaxy (2025).
- H. C. Plummer, "On the problem of distribution in globular star clusters", MNRAS 71, 460
  (1911).
- C. C. Lin and F. H. Shu, "On the spiral structure of disk galaxies", ApJ 140, 646 (1964).
- J. Binney and S. Tremaine, Galactic Dynamics, 2nd ed., Princeton University Press (2008).
- C. Wellons, "Prospecting for hash functions", nullprogram.com (2018).
- B. Karis, "High-quality temporal supersampling", SIGGRAPH Advances in Real-Time Rendering
  (2014).
- M. Salvi, "An excursion in temporal supersampling", GDC (2016).
- J. Jimenez, "Next generation post processing in Call of Duty: Advanced Warfare", SIGGRAPH
  Advances in Real-Time Rendering (2014).
- S. Lagarde and C. de Rousiers, "Moving Frostbite to physically based rendering", SIGGRAPH
  Physically Based Shading course (2014).
- B. Lindbloom, "Chromatic adaptation" (Bradford transform), brucelindbloom.com.
- Khronos Group, "PBR Neutral tone mapping" (2024).
- S. van der Walt and N. Smith, "A better default colormap for Matplotlib", SciPy (2015).
- GRAVITY Collaboration, "Spatially resolved rotation of the broad-line region of a quasar at
  sub-parsec scale", Nature 563, 657 (2018).
- M. L. Lister et al., "MOJAVE XVIII. Kinematics and inner jet evolution of bright radio-loud
  active galaxies", ApJ 923, 30 (2021).
- S. Ge et al., "Black hole masses of quasars from C IV", AJ 157, 148 (2019).
- Event Horizon Telescope Collaboration, "First M87 Event Horizon Telescope results. VI. The
  shadow and mass of the central black hole", ApJL 875, L6 (2019).
- J. C. A. Miller-Jones et al., "Cygnus X-1 contains a 21-solar mass black hole", Science 371,
  1046 (2021).
