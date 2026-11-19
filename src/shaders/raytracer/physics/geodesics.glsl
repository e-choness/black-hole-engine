// Role: Kerr metric helpers and photon geodesic integration.
//       Two integration families:
//         1. Schwarzschild Binet photon solver (u = 1/r) - exact for a = 0, with perturbative
//            spin heuristics in the fast and Kerr-inspired modes.
//         2. Full Kerr: null geodesics of the Kerr metric in Cartesian Kerr-Schild coordinates,
//            integrated with an adaptive Dormand-Prince 5(4) scheme.

const float KERR_M = 0.5; // r_s = 1 => M = r_s/2

float kerr_spin_a() {
    return bh_rotation_enabled * bh_spin * KERR_M;
}

float kerr_horizon_radius(float a) {
    return KERR_M + sqrt(max(KERR_M*KERR_M - a*a, 0.0));
}

// ═══════════════════════════════════════════════════════════════════
// 1. Schwarzschild Binet photon solver (fast and Kerr-inspired modes;
//    also reused inside the horizon)
// ═══════════════════════════════════════════════════════════════════

float geodesic_accel(float u, float spin_alignment) {
    float schwarzschild_accel = -u + 1.5*u*u;
    float u_drag = min(u, 1.2);
    float frame_drag_term = photon_spin_lensing_scale *
        bh_rotation_enabled * bh_spin * bh_spin_strength *
        spin_alignment * 0.8 * u_drag*u_drag*u_drag;
    return schwarzschild_accel + frame_drag_term;
}

void integrate_geodesic_step(inout float u, inout float du, float step,
        float spin_alignment) {
    {{#rk4_integration}}
    float k1_u = du;
    float k1_du = geodesic_accel(u, spin_alignment);

    float u2 = u + 0.5*step*k1_u;
    float du2 = du + 0.5*step*k1_du;
    float k2_u = du2;
    float k2_du = geodesic_accel(u2, spin_alignment);

    float u3 = u + 0.5*step*k2_u;
    float du3 = du + 0.5*step*k2_du;
    float k3_u = du3;
    float k3_du = geodesic_accel(u3, spin_alignment);

    float u4 = u + step*k3_u;
    float du4 = du + step*k3_du;
    float k4_u = du4;
    float k4_du = geodesic_accel(u4, spin_alignment);

    u += (step/6.0) * (k1_u + 2.0*k2_u + 2.0*k3_u + k4_u);
    du += (step/6.0) * (k1_du + 2.0*k2_du + 2.0*k3_du + k4_du);
    {{/rk4_integration}}
    {{^rk4_integration}}
    du += 0.5 * geodesic_accel(u, spin_alignment) * step;
    u  += du * step;
    du += 0.5 * geodesic_accel(u, spin_alignment) * step;
    {{/rk4_integration}}
}

{{#full_kerr}}
// ═══════════════════════════════════════════════════════════════════
// 2. Full Kerr geodesics in Cartesian Kerr-Schild (CKS) coordinates
// ═══════════════════════════════════════════════════════════════════
//
// Kerr-Schild form of the Kerr metric, regular across the future horizon (Kerr & Schild 1965;
// Visser 2007, arXiv:0706.0622, sec. 4):
//   g_mn = eta_mn + f l_m l_n,   f = 2 M r^3 / (r^4 + a^2 z^2),
//   l_m = (1, (r x + a y) / (r^2 + a^2), (r y - a x) / (r^2 + a^2), z / r),
// where the Kerr-Schild radius solves r^4 - (x^2 + y^2 + z^2 - a^2) r^2 - a^2 z^2 = 0 and equals
// the Boyer-Lindquist r. Vectors are stored as (x, y, z, t). Photons follow Hamilton's equations
// for H = 1/2 g^mn p_m p_n with g^mn = eta^mn - f l^m l^n and (l.p) = -p_t + l.p_vec:
//   dx/dl = p - f (l.p) l,   dt/dl = -p_t + f (l.p),
//   dp/dl = 1/2 (l.p)^2 grad f + f (l.p) (grad l).p.
// The energy p_t and the axial momentum p_phi = x p_y - y p_x are conserved.

float ks_radius(vec3 x, float a) {
    float a2 = a*a;
    float w = dot(x, x) - a2;
    float q = sqrt(w*w + 4.0*a2*x.z*x.z);
    // For w < 0 the root (w + q) / 2 cancels; 2 a^2 z^2 / (q - w) is the same value.
    float r2 = w >= 0.0 ? 0.5*(w + q) : 2.0*a2*x.z*x.z / max(q - w, 1e-30);
    return sqrt(r2);
}

// grad r = (r^3 x, r^3 y, r (r^2 + a^2) z) / (r^4 + a^2 z^2), by implicit differentiation.
vec3 ks_radius_gradient(vec3 x, float r, float a) {
    float r2 = r*r;
    return vec3(r2*r*x.x, r2*r*x.y, r*(r2 + a*a)*x.z) / (r2*r2 + a*a*x.z*x.z);
}

// Boyer-Lindquist-like point (length r, height z = r cos(theta)) in which the emitters measure
// radii and heights, as they do for the Binet solver.
vec3 ks_to_bl_position(vec3 x, float r, float a) {
    return vec3(x.xy * (r / sqrt(r*r + a*a)), x.z);
}

void kerr_rhs(vec4 x, vec3 p, float p_t, float a, out vec4 dx, out vec3 dp) {
    float r = ks_radius(x.xyz, a);
    float r2 = r*r;
    float a2 = a*a;
    float ra2 = r2 + a2;
    float D = r2*r2 + a2*x.z*x.z;
    float f = 2.0*KERR_M*r2*r / D;
    vec3 l = vec3((r*x.x + a*x.y) / ra2, (r*x.y - a*x.x) / ra2, x.z / r);
    float lp = -p_t + dot(l, p);
    vec3 grad_r = vec3(r2*r*x.x, r2*r*x.y, r*ra2*x.z) / D;
    // (d_j l).p = A_j + B d_j r and grad f = f [(3/r - 4 r^3/D) grad r - (2 a^2 z / D) e_z].
    vec3 A = vec3((r*p.x - a*p.y) / ra2, (a*p.x + r*p.y) / ra2, p.z / r);
    float B = (p.x*(x.x - 2.0*r*l.x) + p.y*(x.y - 2.0*r*l.y)) / ra2 - p.z*x.z / r2;
    float C = 0.5*lp*(3.0/r - 4.0*r2*r / D) + B;
    dx = vec4(p - f*lp*l, -p_t + f*lp);
    dp = f*lp*(C*grad_r + A - vec3(0.0, 0.0, lp*a2*x.z / D));
}

// Dormand & Prince (1980) 5(4) tableau. Row s lists a_s1..a_s(s-1) for stages 2..7; the last row
// equals the fifth-order weights, so stage 7 is the derivative at the new point (FSAL).
const float DP_A[21] = float[21](
    1.0/5.0,
    3.0/40.0, 9.0/40.0,
    44.0/45.0, -56.0/15.0, 32.0/9.0,
    19372.0/6561.0, -25360.0/2187.0, 64448.0/6561.0, -212.0/729.0,
    9017.0/3168.0, -355.0/33.0, 46732.0/5247.0, 49.0/176.0, -5103.0/18656.0,
    35.0/384.0, 0.0, 500.0/1113.0, 125.0/192.0, -2187.0/6784.0, 11.0/84.0);
// Fifth- minus fourth-order weights, the local error estimate.
const float DP_E[7] = float[7](
    71.0/57600.0, 0.0, -71.0/16695.0, 71.0/1920.0, -17253.0/339200.0, 22.0/525.0, -1.0/40.0);

// Trial step of size h from (x, p) whose derivative is (dx, dp). Writes the fifth-order end
// point and its derivative and returns the error relative to the mixed tolerance; the step is
// acceptable when the result is at most 1.
float kerr_dp45_step(vec4 x, vec3 p, vec4 dx, vec3 dp, float h, float p_t, float a,
        out vec4 x_new, out vec3 p_new, out vec4 dx_new, out vec3 dp_new) {
    vec4 kx[7];
    vec3 kp[7];
    kx[0] = dx;
    kp[0] = dp;
    x_new = x;
    p_new = p;
    int row = 0;
    for (int s = 1; s < 7; s++) {
        vec4 sx = vec4(0.0);
        vec3 sp = vec3(0.0);
        for (int j = 0; j < s; j++) {
            sx += DP_A[row + j]*kx[j];
            sp += DP_A[row + j]*kp[j];
        }
        row += s;
        x_new = x + h*sx;
        p_new = p + h*sp;
        vec4 kxs;
        vec3 kps;
        kerr_rhs(x_new, p_new, p_t, a, kxs, kps);
        kx[s] = kxs;
        kp[s] = kps;
    }
    dx_new = kx[6];
    dp_new = kp[6];
    vec3 ex = vec3(0.0);
    vec3 ep = vec3(0.0);
    for (int s = 0; s < 7; s++) {
        ex += DP_E[s]*kx[s].xyz;
        ep += DP_E[s]*kp[s];
    }
    float scale_x = KERR_ATOL + KERR_RTOL*max(length(x.xyz), length(x_new.xyz));
    float scale_p = KERR_ATOL + KERR_RTOL*max(length(p), abs(p_t));
    return h*max(length(ex) / scale_x, length(ep) / scale_p);
}

// Frame-dragging angular velocity of the zero-angular-momentum observer, 2 M a r / A with
// A = (r^2 + a^2)^2 - a^2 Delta sin^2(theta) (Bardeen, Press & Teukolsky 1972).
float kerr_zamo_omega(float r, float cos2, float a) {
    float ra2 = r*r + a*a;
    float delta = r*r - 2.0*KERR_M*r + a*a;
    return 2.0*KERR_M*a*r / max(ra2*ra2 - a*a*delta*(1.0 - cos2), 1e-8);
}

// Keplerian angular velocity of circular equatorial orbits; sense = +1 is counter-clockwise
// about +z (Bardeen, Press & Teukolsky 1972, eq. 2.16).
float kerr_kepler_omega(float r, float a, float sense) {
    float sqrt_m = sqrt(KERR_M);
    return sense*sqrt_m / (pow(max(r, 1e-3), 1.5) + sense*a*sqrt_m);
}

// Frequency, relative to the traced observer, that gas on the stationary orbit d_t + omega d_phi
// through the Boyer-Lindquist-like point q measures for the ray (p_t, p_phi):
//   p.u = u^t (p_t + omega p_phi),
//   (u^t)^-2 = 1 - omega^2 (r^2 + a^2) sin^2(theta) - f (1 - omega a sin^2(theta))^2,
// with f = 2 M r / (r^2 + a^2 cos^2(theta)). Where that orbit is not timelike (inside the photon
// orbit or the ergosphere) the zero-angular-momentum observer stands in.
float kerr_orbit_frequency(vec3 q, float omega, float p_t, float p_phi, float a) {
    float r = max(length(q), 1e-4);
    float cos2 = q.z*q.z / (r*r);
    float sin2 = max(1.0 - cos2, 0.0);
    float f = 2.0*KERR_M*r / (r*r + a*a*cos2);
    float ra2_sin2 = (r*r + a*a)*sin2;
    float norm = 1.0 - omega*omega*ra2_sin2 - f*SQ(1.0 - omega*a*sin2);
    if (norm < 1e-4) {
        omega = kerr_zamo_omega(r, cos2, a);
        norm = 1.0 - omega*omega*ra2_sin2 - f*SQ(1.0 - omega*a*sin2);
    }
    return (p_t + omega*p_phi) / sqrt(max(norm, 1e-8));
}

// Cubic Hermite interpolant of a step from its end points x0, x1 and end derivatives m0, m1
// (already multiplied by the step size), at the fraction s of the step.
vec3 kerr_hermite(vec3 x0, vec3 x1, vec3 m0, vec3 m1, float s) {
    float s2 = s*s;
    float s3 = s2*s;
    return (2.0*s3 - 3.0*s2 + 1.0)*x0 + (s3 - 2.0*s2 + s)*m0 + (3.0*s2 - 2.0*s3)*x1
        + (s3 - s2)*m1;
}

// Fraction of the step where the Hermite interpolant of z vanishes, given that z changes sign:
// Newton iterations started from the chord's root.
float kerr_hermite_root(float z0, float z1, float m0, float m1) {
    float s = clamp(z0 / (z0 - z1), 0.0, 1.0);
    for (int i = 0; i < 3; i++) {
        float s2 = s*s;
        float z = (2.0*s2*s - 3.0*s2 + 1.0)*z0 + (s2*s - 2.0*s2 + s)*m0
            + (3.0*s2 - 2.0*s2*s)*z1 + (s2*s - s2)*m1;
        float dz = (6.0*s2 - 6.0*s)*(z0 - z1) + (3.0*s2 - 4.0*s + 1.0)*m0 + (3.0*s2 - 2.0*s)*m1;
        if (abs(dz) > 1e-12) s = clamp(s - z / dz, 0.0, 1.0);
    }
    return s;
}
{{/full_kerr}}
