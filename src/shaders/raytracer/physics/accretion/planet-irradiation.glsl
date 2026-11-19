// Colour temperature of the disk light that reaches the planet: the flux-weighted temperature
// of a few annuli, redshifted from the emission radius to the planet's distant orbit.
float planet_irradiation_temperature() {
    {{#accretion_thin_disk}}
    float r1 = ACCRETION_MIN_R * 1.8;
    float r2 = ACCRETION_MIN_R * 2.8;
    float r3 = ACCRETION_MIN_R * 4.2;

    float w1 = disk_relative_flux(r1, 0.0);
    float w2 = disk_relative_flux(r2, 0.0);
    float w3 = disk_relative_flux(r3, 0.0);
    float wsum = max(w1 + w2 + w3, 1e-4);

    float t1 = disk_temperature_at(r1, 0.0) * static_redshift(r1);
    float t2 = disk_temperature_at(r2, 0.0) * static_redshift(r2);
    float t3 = disk_temperature_at(r3, 0.0) * static_redshift(r3);
    return disk_color_correction * (w1*t1 + w2*t2 + w3*t3) / wsum;
    {{/accretion_thin_disk}}

    {{#accretion_thick_torus}}
    float r_t = max(torus_r0 * 1.25, ACCRETION_MIN_R + 0.5);
    return torus_temperature(r_t) * static_redshift(r_t);
    {{/accretion_thick_torus}}

    {{#accretion_slim_disk}}
    float r_s = ACCRETION_MIN_R * 1.6;
    return disk_color_correction * slim_disk_temperature(r_s) * static_redshift(r_s);
    {{/accretion_slim_disk}}

    return disk_temperature_peak;
}
