// Physical constants in SI units: CODATA 2022 recommended values
// (https://physics.nist.gov/cuu/Constants/) unless noted. The solar mass parameter GM_sun is the
// IAU 2015 Resolution B3 nominal value (Prša et al. 2016, arXiv:1605.09788); it is known about
// five orders of magnitude better than G or M_sun separately, so every mass scale goes through it.

export const SPEED_OF_LIGHT = 299792458; // m s^-1, exact
export const GRAVITATIONAL_CONSTANT = 6.6743e-11; // m^3 kg^-1 s^-2
export const SOLAR_MASS_PARAMETER = 1.3271244e20; // GM_sun, m^3 s^-2
export const SOLAR_MASS = SOLAR_MASS_PARAMETER / GRAVITATIONAL_CONSTANT; // kg
export const SOLAR_LUMINOSITY = 3.828e26; // W, IAU 2015 B3 nominal value
export const PROTON_MASS = 1.67262192595e-27; // kg
export const THOMSON_CROSS_SECTION = 6.6524587051e-29; // m^2
export const STEFAN_BOLTZMANN = 5.670374419e-8; // W m^-2 K^-4, exact since the 2019 SI revision
export const STANDARD_GRAVITY = 9.80665; // m s^-2, exact

export const ASTRONOMICAL_UNIT = 149597870700; // m, exact (IAU 2012 B2)
export const JULIAN_YEAR = 31557600; // s, 365.25 days
export const LIGHT_YEAR = SPEED_OF_LIGHT * JULIAN_YEAR; // m, IAU definition
export const PARSEC = (648000 / Math.PI) * ASTRONOMICAL_UNIT; // m (IAU 2015 B2)

export const MINUTE = 60;
export const HOUR = 3600;
export const DAY = 86400;
export const JOULE_IN_ERG = 1e7;
