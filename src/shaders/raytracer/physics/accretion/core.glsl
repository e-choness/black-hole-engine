// Role: Shared accretion-flow helpers: the disk rotation sense, the azimuth convention and the
//       turbulence pattern that modulates the emissivity of every flow model as a look.

float loopable_turbulence_time(float t) {
    // Always wrap to prevent float32 precision loss in fbm/value_noise.
    // Without wrapping, large t values cause fract()/floor() to lose
    // sub-grid-cell resolution in the highest FBM octaves, flattening
    // fine turbulence detail over time (most visible after ~1 hour).
    // When the explicit loop is off, use a long prime period (10007 s
    // ≈ 2.78 h) so the wrap is imperceptible; when on, use the user
    // period for seamless video loops.
    float period = (turbulence_loop_enabled < 0.5)
        ? 10007.0
        : max(turbulence_loop_seconds, 1e-4);
    float wrapped = mod(t, period);
    if (wrapped < 0.0) wrapped += period;
    return wrapped;
}

float disk_rotation_sign() {
    // Keep the existing prograde default when spin is zero/off, but flip the
    // co-rotating flow for explicitly negative a/M.
    return (bh_rotation_enabled > 0.5 && bh_spin < 0.0) ? -1.0 : 1.0;
}

float equatorial_azimuth(vec2 xy) {
    // GLSL's two-argument atan is atan(y, x); swapping the arguments reverses
    // the phase advection direction.
    return atan(xy.y, xy.x);
}

float accretion_turbulence(float radius, float angle, float t) {
    float orbit_phase = angle - disk_rotation_sign() * 0.45*t / pow(max(radius, 1.001), 1.5);
    vec2 orbit_unit = vec2(cos(orbit_phase), sin(orbit_phase));

    // Use periodic angular coordinates to avoid seam artifacts at angle wrap.
    float large_scale = fbm(vec2(
        radius*2.5 + orbit_unit.x*4.5,
        orbit_unit.y*4.5 + t*0.08
    ));
    float small_scale = fbm(vec2(
        radius*12.0 + orbit_unit.x*15.0 + 2.5*large_scale,
        orbit_unit.y*15.0 - t*0.18
    ));
    // High-frequency chaos layer, moving faster and concentrated near the middle (ISCO)
    float micro_scale = fbm(vec2(
        radius*25.0 + orbit_unit.x*35.0 - small_scale*4.0,
        orbit_unit.y*35.0 + t*0.55
    ));

    // Distort the regular spiral using small_scale noise so it looks chaotic instead of uniform stripes
    float swirl_phase = 12.0*orbit_phase + 8.0*log(max(radius, 1.001)) + small_scale * 4.0;
    float swirl = sin(swirl_phase);

    float isco_factor = exp(-0.8 * max(radius - ACCRETION_MIN_R, 0.0));
    float filaments = 0.6 + 0.4*swirl;

    // Mix scales, giving micro_scale more weight near the center
    float base_plasma = mix(large_scale, small_scale, 0.5);
    float plasma = mix(base_plasma, micro_scale, 0.3 + 0.5 * isco_factor);

    return max((0.4 + 1.25*plasma) * (0.8 + 0.2*filaments), 0.02);
}

// Outer edge of the thin disk: surface density, and with it the emission and the optical depth,
// tapers to zero over the last fifth of ACCRETION_WIDTH. The inner edge needs no taper: the
// Page-Thorne flux itself vanishes at the ISCO.
float accretion_outer_fade(float radius) {
    return 1.0 - smoothstep(0.78, 1.0, (radius - ACCRETION_MIN_R) / ACCRETION_WIDTH);
}

// Turbulent modulation of the thin-disk emissivity.
float accretion_emissivity(float radius, float angle, float t) {
    return accretion_turbulence(radius, angle, t) * accretion_outer_fade(radius);
}
