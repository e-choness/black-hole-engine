# Physics of the renderer

Development notes on how the ray tracer models light near a black hole: the units, the two
geodesic solvers, the camera frames, the frequency shifts applied to every emitter, and how the
results are validated. Equations are written in the shader's units unless stated otherwise.

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
  with one ray per pixel against a saturated sky, so a pixel is bright exactly when its ray
  escapes. Escaping rays that land on black parts of the sky texture would look captured, so
  each view is rendered at four camera azimuths about the spin axis and a pixel counts as
  captured only when it is dark in all of them. The edge in each angular sector is the smallest
  radius of an escaping pixel, which approaches it from outside within a fraction of a pixel.
  - `a = 0`, both solvers, `r = 5` and `11 r_s`: the angular radius in 16 sectors matches
    `sin(psi) = (3 sqrt(3)/2)(r_s/r) sqrt(1 - r_s/r)` (Synge 1966) within 1 %. Measured:
    Kerr-inspired (Binet) -0.11 to -0.21 %, Full Kerr +0.005 to +0.08 %.
  - `a/M = 0.9`, Full Kerr, `r = 30 r_s`, inclination 87 degrees: the flattened prograde edge
    and the far retrograde edge, converted to impact parameters with
    `b = r sin(psi) / sqrt(1 - r_s/r)`, match the Bardeen curve within 3 % of its width.
    Measured: +1.3 % and -0.6 %, part of which is the `g_t_phi / g_tt ~ 0.03 M` shift of a static
    observer at that distance.

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
