{{#accretion_slim_disk}}
// Slim disk: super-Eddington accretion, extends inside ISCO
// Radiation-pressure supported, geometrically thicker than thin disk
float slim_disk_height(float cyl_r) {
    // User-configurable base H/R ratio (default ~0.15, range 0.05-0.5)
    float base_h = max(slim_h_ratio, 0.05);
    // Puffs up near and inside ISCO due to radiation pressure
    float puff = max(slim_puff_factor, 0.0);
    float isco_proximity = exp(-1.5 * max(cyl_r - ACCRETION_MIN_R, 0.0));
    return max(cyl_r * base_h * (1.0 + puff * isco_proximity), 0.01);
}

float slim_disk_local_emissivity(vec3 p) {
    float cyl_r = length(p.xy);
    float h = slim_disk_height(cyl_r);
    float z_norm = abs(p.z) / h;

    if (z_norm > 3.0 || cyl_r < 0.9) return 0.0;

    float vert = exp(-0.5 * z_norm * z_norm);

    // Extends inside the ISCO, where advection carries a finite flux into the plunging region.
    float radial = disk_relative_flux(cyl_r, DISK_SLIM_STRESS);

    float inner = smoothstep(0.9, 1.3, cyl_r);
    float outer_r = ACCRETION_MIN_R + ACCRETION_WIDTH;
    float outer = 1.0 - smoothstep(outer_r * 0.8, outer_r, cyl_r);

    return vert * radial * inner * outer;
}

float slim_disk_temperature(float cyl_r) {
    // Page-Thorne photosphere with an ISCO torque outside the ISCO; inside it the advected
    // flow heats up as r^-1/2 (Abramowicz+ 1988, Sadowski+ 2009) as a look.
    if (cyl_r >= ACCRETION_MIN_R) return disk_temperature_at(cyl_r, DISK_SLIM_STRESS);
    float t_isco = disk_temperature_at(ACCRETION_MIN_R, DISK_SLIM_STRESS);
    return t_isco * pow(ACCRETION_MIN_R / max(cyl_r, 1.0), 0.5);
}
{{/accretion_slim_disk}}
