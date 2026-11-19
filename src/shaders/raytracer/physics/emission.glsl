// Role: Observed radiance of every emitter. One frequency ratio g = nu_obs/nu_emit (with the
//       photon energy normalised to the camera) sets both colour and brightness through the
//       absolute blackbody LUT (CIE 1931 2-degree -> linear sRGB, log10 of the luminance in
//       cd/m^2), so the disk, volumes, planet and sky share one rule. Also holds the
//       Novikov-Thorne/Page-Thorne flux and the disk kinematics of both solvers.

uniform sampler2D emission_lut;      // row 0: blackbody(T), row 1: power law(alpha)
uniform float log2_exposure;         // pre-exposure H applied to absolute luminance
uniform float log2_look_scale;       // log2(H Y_ref) for display-referred look layers
uniform float radiance_visible;      // 1: photometric Y(g f_col T); 0: bolometric (g T)^4
uniform float bolometric_log2_coeff; // log2(K_6504 sigma / pi), luminance of (sigma T^4 / pi)

uniform float disk_temperature_peak; // K, effective temperature at the flux maximum
uniform float disk_uniform_temperature; // 1: the whole disk at disk_temperature_peak
uniform float disk_color_correction; // f_col
uniform vec2 disk_limb;              // L(mu) = x + y mu, normalised to 2 int L mu dmu = 1
uniform float disk_opacity;
uniform float disk_spin_a;           // |a|/M of the prograde disk
uniform float disk_pt_x0;            // sqrt(r_isco / M)
uniform vec3 disk_pt_roots;          // roots of x^3 - 3x + 2a
uniform vec3 disk_pt_coeffs;         // 3 (x_i - a)^2 / (x_i (x_i - x_j)(x_i - x_k))
uniform float disk_flux_max;         // maximum of the zero-torque flux for this spin
uniform vec2 disk_isco_el;           // specific energy and angular momentum of the ISCO orbit

const float EMISSION_LUT_SIZE = 512.0;
const float BB_LOG_T_MIN = 6.2146080984;   // ln(500 K)
const float BB_LOG_T_SPAN = 7.6009024595;  // ln(1e6 K / 500 K)
const float BB_T_MAX = 1.0e6;
const float PL_ALPHA_MIN = -1.0;
const float PL_ALPHA_SPAN = 4.0;
const float LOG2_10 = 3.3219280949;
const float LN_10 = 2.302585093;

// Zero-torque disks are dark at the ISCO; these extra torques (Agol & Krolik 2000 form, a
// constant added to the Page-Thorne bracket in units of x0) give the GRMHD and slim looks
// emission at and inside the ISCO. Look values, not fitted to simulations.
const float DISK_GRMHD_STRESS = 0.008;
const float DISK_SLIM_STRESS = 0.02;

vec4 emission_lut_row(float u, int row) {
    float uc = clamp(u, 0.0, EMISSION_LUT_SIZE - 1.0);
    int i = min(int(uc), int(EMISSION_LUT_SIZE) - 2);
    vec4 a = texelFetch(emission_lut, ivec2(i, row), 0);
    vec4 b = texelFetch(emission_lut, ivec2(i + 1, row), 0);
    return mix(a, b, uc - float(i));
}

// rgb: unit-luminance linear sRGB; a: log10 of the luminance in cd/m^2. Above 1e6 K the visible
// band is Rayleigh-Jeans: the chromaticity is fixed and Y(T) = A T - B + O(1/T) continues along
// its tangent at 1e6 K. Below 500 K the log-log slope of the first entries continues.
vec4 blackbody(float temperature) {
    float u = (log(max(temperature, 1.0)) - BB_LOG_T_MIN) / BB_LOG_T_SPAN * (EMISSION_LUT_SIZE - 1.0);
    vec4 s = emission_lut_row(u, 0);
    if (u > EMISSION_LUT_SIZE - 1.0) {
        float below = texelFetch(emission_lut, ivec2(int(EMISSION_LUT_SIZE) - 2, 0), 0).a;
        float slope = (s.a - below) * (EMISSION_LUT_SIZE - 1.0) * LN_10 / BB_LOG_T_SPAN;
        s.a += log(1.0 + slope * (temperature / BB_T_MAX - 1.0)) / LN_10;
    } else if (u < 0.0) {
        s.a += u * (texelFetch(emission_lut, ivec2(1, 0), 0).a - texelFetch(emission_lut, ivec2(0, 0), 0).a);
    }
    return s;
}

// Unit-luminance colour of an optically thin synchrotron spectrum F_nu ~ nu^-alpha; a Doppler
// shift leaves it unchanged and only scales the brightness by g^(3 + alpha).
vec3 power_law_color(float alpha) {
    return emission_lut_row((alpha - PL_ALPHA_MIN) / PL_ALPHA_SPAN * (EMISSION_LUT_SIZE - 1.0), 1).rgb;
}

// Frequency ratio used for the colour (doppler_shift) and for the brightness (beaming). The
// cinematic option softens the bolometric g^4 to g^(1.05 + 1.1 boost) over a limited range.
float color_shift(float g) {
    {{#doppler_shift}}
    return g;
    {{/doppler_shift}}
    {{^doppler_shift}}
    return 1.0;
    {{/doppler_shift}}
}

float brightness_shift(float g) {
    {{#beaming}}
    {{#physical_beaming}}
    return g;
    {{/physical_beaming}}
    {{^physical_beaming}}
    return pow(clamp(g, 0.676, 1.613), (1.05 + 1.1*clamp(look_doppler_boost, 0.0, 2.5)) / 4.0);
    {{/physical_beaming}}
    {{/beaming}}
    {{^beaming}}
    return 1.0;
    {{/beaming}}
}

// Pre-exposed radiance of a blackbody photosphere of effective temperature t_eff and colour
// correction f_col: I = f_col^-4 B(g f_col T) in the visible model, sigma (g T)^4 / pi in the
// bolometric one; the colour always comes from the chromaticity at g f_col T.
vec3 thermal_radiance(float t_eff, float f_col, float g) {
    float gc = color_shift(g);
    float gb = brightness_shift(g);
    vec4 seen = blackbody(f_col * gc * t_eff);
    float log2_y;
    if (radiance_visible > 0.5) {
        float log10_y = (gb == gc) ? seen.a : blackbody(f_col * gb * t_eff).a;
        log2_y = log10_y * LOG2_10 - 4.0 * log2(f_col);
    } else {
        log2_y = bolometric_log2_coeff + 4.0 * log2(max(gb * t_eff, 1e-3));
    }
    return seen.rgb * exp2(min(log2_y + log2_exposure, 40.0));
}

// Brightness ratio of a source whose rest-frame spectrum is a blackbody at temperature t,
// observed with frequency ratio g: Y(g t) / Y(t) or g^4.
float thermal_brightness_ratio(float t, float g) {
    float gb = brightness_shift(g);
    if (radiance_visible > 0.5) return exp2((blackbody(gb * t).a - blackbody(t).a) * LOG2_10);
    return SQ(SQ(gb));
}

// Sky texels approximate the colour of integrated starlight by a blackbody of the correlated
// colour temperature (McCamy 1992); their colour and brightness then shift like any blackbody.
vec3 shifted_sky_radiance(vec3 rgb, float g) {
    if (abs(g - 1.0) < 1e-4) return rgb;
    vec3 xyz = mat3(0.4124564, 0.2126729, 0.0193339,
                    0.3575761, 0.7151522, 0.1191920,
                    0.1804375, 0.0721750, 0.9503041) * rgb;
    float s = xyz.x + xyz.y + xyz.z;
    if (xyz.y < 1e-7) return rgb;
    float n = (xyz.x / s - 0.3320) / (0.1858 - xyz.y / s);
    float t = clamp(((449.0*n + 3525.0)*n + 6823.3)*n + 5520.33, 1700.0, 25000.0);
    vec3 rest = blackbody(t).rgb;
    vec3 seen = blackbody(color_shift(g) * t).rgb;
    return rgb * (seen / max(rest, vec3(1e-3))) * thermal_brightness_ratio(t, g);
}

// Galactic direction of a hole-frame sky direction, in the frame of the sky cube map (x towards
// the Galactic Centre, z towards the north galactic pole).
vec3 sky_direction(vec3 ray) {
    vec3 p = ray * BG_COORDS;
    return vec3(p.y, -p.x, p.z);
}

float static_redshift(float r) {
    return sqrt(max(1.0 - 1.0 / max(r, 1.0001), 1e-4));
}

// --- Novikov-Thorne / Page-Thorne disk (Page & Thorne 1974), x = sqrt(r/M) ---------------

float page_thorne_bracket(float x) {
    vec3 ratio = (x - disk_pt_roots) / (disk_pt_x0 - disk_pt_roots);
    return x - disk_pt_x0 - 1.5*disk_spin_a*log(x / disk_pt_x0) - dot(disk_pt_coeffs, log(max(ratio, vec3(1e-30))));
}

// Comoving flux relative to the zero-torque maximum. A stress term K = stress x0 adds the flux
// of a torque at the ISCO, which then continues inward as (r / r_isco)^1.5.
float disk_relative_flux(float r, float stress) {
    float x = sqrt(max(r, 1e-4) / KERR_M);
    float xc = max(x, disk_pt_x0);
    float d = xc*xc*xc - 3.0*xc + 2.0*disk_spin_a;
    float flux = (page_thorne_bracket(xc) + stress*disk_pt_x0) / (SQ(SQ(xc)) * max(d, 1e-6));
    if (x < disk_pt_x0) flux *= SQ(x / disk_pt_x0) * (x / disk_pt_x0);
    return max(flux, 0.0) / disk_flux_max;
}

float disk_temperature_at(float r, float stress) {
    if (disk_uniform_temperature > 0.5) return disk_temperature_peak;
    return disk_temperature_peak * pow(disk_relative_flux(r, stress), 0.25);
}

float disk_limb_darkening(float mu) {
    return disk_limb.x + disk_limb.y * clamp(mu, 0.0, 1.0);
}

// Boyer-Lindquist (u^t, u^r, u^phi) of gas plunging from the ISCO with its E and L
// (Cunningham 1975), at the equator, in units of M with a >= 0.
vec3 plunging_velocity(float rm, float a) {
    float E = disk_isco_el.x;
    float L = disk_isco_el.y;
    float r2a2 = rm*rm + a*a;
    float delta = max(rm*rm - 2.0*rm + a*a, 1e-6);
    float P = E*r2a2 - a*L;
    float radial = P*P - delta*(rm*rm + SQ(L - a*E));
    return vec3((r2a2*P/delta - a*(a*E - L)) / (rm*rm),
                -sqrt(max(radial, 0.0)) / (rm*rm),
                (a*P/delta - (a*E - L)) / (rm*rm));
}

{{^full_kerr}}
// Binet solver: the photon has energy E, angular momentum Lz about the spin axis and total
// angular momentum L (code units, per camera frequency). A circular Kerr orbit gives
// nu_em = u^t (E - Omega Lz); the plunging flow adds -p_r u^r, with the Schwarzschild p_r of the
// Binet orbit whose sign follows the backward trace (du > 0: the photon was outgoing). The
// fluid-frame emission angle is mu = |p_z| / nu_em with |p_z| = sqrt(L^2 - Lz^2) / r. Returns
// (g, mu); sense < 0 mirrors a clockwise disk.
vec2 binet_disk_shift(float r, float sense, float E, float Lz, float L, float du_sign) {
    float a = disk_spin_a;
    float rm = r / KERR_M;
    float lz = sense * Lz / KERR_M;
    float l = L / KERR_M;
    float nu;
    if (r >= ACCRETION_MIN_R) {
        float s = sqrt(rm);
        float ut = (rm*s + a) / (pow(rm, 0.75) * sqrt(max(rm*s - 3.0*s + 2.0*a, 1e-6)));
        nu = ut * (E - lz / (rm*s + a));
    } else {
        vec3 u = plunging_velocity(rm, a);
        float f = max(1.0 - 2.0 / rm, 1e-4);
        float pr = du_sign * sqrt(max(E*E - f*l*l / (rm*rm), 0.0)) / f;
        nu = E*u.x - pr*u.y - lz*u.z;
    }
    nu = max(nu, 1e-4);
    return vec2(1.0 / nu, sqrt(max(l*l - lz*lz, 0.0)) / (rm * nu));
}

// Binet solver: frequency ratio of a flow rotating rigidly at angular velocity omega (code
// units) about the spin axis at pos, in the Schwarzschild geometry of the solver.
float binet_flow_shift(vec3 pos, float omega, float E, float Lz) {
    float r = max(length(pos), 1.0001);
    float ut = 1.0 / sqrt(max(1.0 - 1.0 / r - SQ(omega) * dot(pos.xy, pos.xy), 1e-4));
    return 1.0 / max(ut * (E - omega * Lz), 1e-4);
}

// Keplerian angular velocity of a prograde equatorial Kerr orbit, in code units.
float binet_kepler_omega(float r) {
    return 1.0 / ((pow(r / KERR_M, 1.5) + disk_spin_a) * KERR_M);
}
{{/full_kerr}}

{{#full_kerr}}
// Full Kerr: nu_em = p.u for the backward covector (p_t, p) at the Cartesian Kerr-Schild
// crossing q (z = 0, x^2 + y^2 = r^2 + a^2) with r >= r_isco circular and plunging inside.
// The plunging 4-velocity goes BL -> KS (u^t += 2Mr/Delta u^r, u^phi += a/Delta u^r) -> Cartesian
// (u^x = l_x u^r - y u^phi, u^y = l_y u^r + x u^phi). A clockwise disk (sense < 0, a < 0) is
// evaluated in the mirror image y -> -y. Returns (g, mu) with mu = |p_z| / nu_em.
vec2 kerr_disk_shift(vec3 q, vec3 isec, float r, float a, float sense, float p_t, float p_phi,
        vec3 p, float nu_cam) {
    float nu;
    if (r >= ACCRETION_MIN_R) {
        nu = kerr_orbit_frequency(isec, kerr_kepler_omega(r, a, sense), p_t, p_phi, a);
    } else {
        float am = abs(a);
        vec2 xy = vec2(q.x, sense*q.y);
        vec2 pxy = vec2(p.x, sense*p.y);
        float rm = r / KERR_M;
        float amm = am / KERR_M;
        vec3 u = plunging_velocity(rm, amm);
        float delta = max(rm*rm - 2.0*rm + amm*amm, 1e-6);
        float ut = u.x + 2.0*rm / delta * u.y;
        float uphi = (u.z + amm / delta * u.y) / KERR_M;
        vec2 l = vec2(r*xy.x + am*xy.y, r*xy.y - am*xy.x) / (r*r + am*am);
        nu = p_t*ut + pxy.x*(l.x*u.y - xy.y*uphi) + pxy.y*(l.y*u.y + xy.x*uphi);
    }
    nu = max(nu, 1e-6);
    return vec2(nu_cam / nu, abs(p.z) / nu);
}
{{/full_kerr}}
