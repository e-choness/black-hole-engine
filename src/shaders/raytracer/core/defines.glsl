// Role: Global macro definitions, uniform declarations, and scene constants used
//       across all shader stages. Loaded first in the shader concatenation order.

#define M_PI 3.141592653589793238462643383279
#define R_SQRT_2 0.7071067811865475
#define DEG_TO_RAD (M_PI/180.0)
#define SQ(x) ((x)*(x))

// Note: despite the name, this is NOT a pure Y-axis rotation. It swaps the
// XY axes and applies a rotation by angle `a` in the YZ plane. Used only for
// background and planet texture coordinate transforms.
#define ROT_Y(a) mat3(0, cos(a), sin(a), 1, 0, 0, 0, sin(a), -cos(a))


uniform vec2 resolution;
uniform float time;
uniform float turbulence_time_offset;
uniform float turbulence_loop_enabled;
uniform float turbulence_loop_seconds;

uniform vec3 cam_pos;
uniform vec3 cam_x;
uniform vec3 cam_y;
uniform vec3 cam_z;
uniform vec3 cam_vel;
uniform vec2 cam_pan;
uniform vec2 taa_jitter;

uniform float interior_mode; // 0.0 = exterior (capture at horizon), 1.0 = interior (trace past horizon)
uniform float cam_rain; // 1.0 while the camera rides the rain frame of the dive

// nu_infinity/nu_static at the camera: sqrt(1 - r_s/r) for cameras referenced to the static
// observer, 1.0 in the rain frame (whose per-ray Doppler factor already covers it).
// Multiplied into the background Doppler factor so both gravitational and
// kinematic Doppler are applied consistently.
uniform float grav_blueshift_factor;

// Full Kerr camera: Cartesian Kerr-Schild position, covariant tetrad legs (x, y, z, t) of the
// observer the rays are launched from, and the physical camera's 4-velocity components in that
// tetrad stored as (c1, c2, c3, c0).
uniform vec3 cam_pos_ks;
uniform vec4 cam_u_cov, cam_e1_cov, cam_e2_cov, cam_e3_cov;
uniform vec4 cam_doppler;

uniform float planet_distance, planet_radius;
uniform float bh_spin, bh_spin_strength, bh_rotation_enabled;
uniform float photon_spin_lensing_scale;
uniform float accretion_inner_r;
uniform float look_disk_gain, look_glow, look_doppler_boost;
uniform float look_aberration_strength;
uniform float look_galaxy_gain;
uniform float torus_r0, torus_h_ratio, torus_radial_falloff, torus_opacity, torus_outer_radius;
uniform float slim_h_ratio, slim_opacity, slim_puff_factor;
uniform float jet_half_angle, jet_lorentz, jet_brightness, jet_length, jet_spectral_index;
{{#jet_physical}}
uniform float jet_magnetization, jet_knot_spacing, jet_corona_brightness;
uniform float jet_base_width, jet_corona_extent;
{{/jet_physical}}

{{#grmhd_enabled}}
uniform float grmhd_r_high, grmhd_magnetic_beta, grmhd_mad_flux;
uniform float grmhd_density_scale, grmhd_turbulence_amp;
uniform float grmhd_electron_kappa, grmhd_magnetic_field_str;
{{/grmhd_enabled}}

uniform sampler2D planet_texture;
uniform samplerCube sky_cube;

// stepping and anti-aliasing parameters
const int NSTEPS = {{n_steps}};
const int SAMPLE_COUNT = {{sample_count}};
const float MAX_REVOLUTIONS = float({{max_revolutions}});

{{#full_kerr}}
// Full Kerr integrator: relative tolerance of the quality preset, absolute tolerance in r_s, and
// the step length, as a fraction of r, inside volumetric emitters.
const float KERR_RTOL = {{kerr_rtol}};
const float KERR_ATOL = 1e-6;
const float KERR_VOLUME_STEP = 0.06;
{{/full_kerr}}

// ACCRETION_MIN_R is now a uniform (accretion_inner_r) that varies with black hole spin
// Using ISCO from Bardeen-Press-Teukolsky formula: r_ISCO = 3 r_s for Schwarzschild
const float ACCRETION_WIDTH = 12.0;
#define ACCRETION_MIN_R accretion_inner_r

// The sky map is a display-referred image (linear sRGB once decoded), scaled like the other look
// layers by H Y_ref; this factor lifts its dark background so the Milky Way band stays visible at
// the default sky gain.
const float SKY_BRIGHTNESS = 8.0;
// Screen-space change of the escape direction (rad per pixel) beyond which neighbouring rays are
// taken to be discontinuous, e.g. on opposite sides of a caustic.
const float SKY_MAX_GRADIENT = 1.0;

const float PLANET_AMBIENT = 0.0;
const float PLANET_LIGHTNESS = 1.5;
const float PLANET_LIGHT_REF_DISTANCE = 14.0;

// Orientation of the galactic sky relative to the hole frame.
mat3 BG_COORDS = ROT_Y(45.0 * DEG_TO_RAD);

// planet texture coordinate system
const float PLANET_AXIAL_TILT = 30.0 * DEG_TO_RAD;
mat3 PLANET_COORDS = ROT_Y(PLANET_AXIAL_TILT);

const float FOV_ANGLE_DEG = 90.0;
float FOV_MULT = 1.0 / tan(DEG_TO_RAD * FOV_ANGLE_DEG*0.5);

// derived "constants" (from uniforms)
float PLANET_RADIUS,
    PLANET_DISTANCE,
    PLANET_ORBITAL_ANG_VEL,
    PLANET_ROTATION_ANG_VEL,
    PLANET_GAMMA;
