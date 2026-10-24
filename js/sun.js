/**
 * High-Precision Solar Position Calculator
 * Implements the standard NOAA / Jean Meeus solar calculations.
 * Given a UTC Date object, latitude, and longitude, calculates:
 * - Solar Elevation (altitude above the horizon in degrees)
 * - Solar Azimuth (compass bearing in degrees clockwise from true North)
 * - Shadow Direction (opposite bearing where shadows are cast)
 * - Compass cardinal direction labels
 */

export function calculateSunPosition(date, lat, lng) {
    const rad = Math.PI / 180;
    const deg = 180 / Math.PI;

    // Julian Date & Century
    const time = date.getTime();
    const julianDate = (time / 86400000) + 2440587.5;
    const julianCentury = (julianDate - 2451545.0) / 36525.0;

    // Geometric Mean Longitude of the Sun (deg)
    let geomMeanLongSun = (280.46646 + julianCentury * (36000.76983 + julianCentury * 0.0003032)) % 360;
    if (geomMeanLongSun < 0) geomMeanLongSun += 360;

    // Geometric Mean Anomaly of the Sun (deg)
    const geomMeanAnomalySun = 357.52911 + julianCentury * (35999.05029 - 0.0001537 * julianCentury);

    // Eccentricity of Earth's Orbit
    const eccentEarthOrbit = 0.016708634 - julianCentury * (0.000042037 + 0.0000001267 * julianCentury);

    // Sun Equation of the Center (deg)
    const sunEqOfCtr = Math.sin(geomMeanAnomalySun * rad) * (1.914602 - julianCentury * (0.004817 + 0.000014 * julianCentury))
        + Math.sin(2 * geomMeanAnomalySun * rad) * (0.019993 - 0.000101 * julianCentury)
        + Math.sin(3 * geomMeanAnomalySun * rad) * 0.000289;

    // Sun True Longitude & Apparent Longitude (deg)
    const sunTrueLong = geomMeanLongSun + sunEqOfCtr;
    const sunApparentLong = sunTrueLong - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * julianCentury) * rad);

    // Mean Obliquity of the Ecliptic & Correction (deg)
    const meanObliqEcliptic = 23 + (26 + ((21.448 - julianCentury * (46.815 + julianCentury * (0.00059 - julianCentury * 0.001813)))) / 60) / 60;
    const obliqCorr = meanObliqEcliptic + 0.00256 * Math.cos((125.04 - 1934.136 * julianCentury) * rad);

    // Sun Declination (deg)
    const sunDeclin = Math.asin(Math.sin(obliqCorr * rad) * Math.sin(sunApparentLong * rad)) * deg;

    // Equation of Time (minutes)
    const y = Math.tan((obliqCorr / 2) * rad) * Math.tan((obliqCorr / 2) * rad);
    const eqOfTime = 4 * deg * (
        y * Math.sin(2 * geomMeanLongSun * rad)
        - 2 * eccentEarthOrbit * Math.sin(geomMeanAnomalySun * rad)
        + 4 * eccentEarthOrbit * y * Math.sin(geomMeanAnomalySun * rad) * Math.cos(2 * geomMeanLongSun * rad)
        - 0.5 * y * y * Math.sin(4 * geomMeanLongSun * rad)
        - 1.25 * eccentEarthOrbit * eccentEarthOrbit * Math.sin(2 * geomMeanAnomalySun * rad)
    );

    // True Solar Time (minutes)
    const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
    const timeOffset = eqOfTime + 4 * lng;
    let trueSolarTime = (utcHours * 60 + timeOffset) % 1440;
    if (trueSolarTime < 0) trueSolarTime += 1440;

    // Hour Angle (deg)
    let hourAngle = trueSolarTime / 4 - 180;
    if (hourAngle < -180) hourAngle += 360;

    // Solar Zenith & Elevation Angle (deg)
    const csz = Math.sin(lat * rad) * Math.sin(sunDeclin * rad) + Math.cos(lat * rad) * Math.cos(sunDeclin * rad) * Math.cos(hourAngle * rad);
    const zenith = Math.acos(Math.max(-1, Math.min(1, csz))) * deg;
    const elevation = 90 - zenith;

    // Solar Azimuth Angle (deg clockwise from North)
    let azimuth = 0;
    const caz = (Math.sin(lat * rad) * Math.cos(zenith * rad) - Math.sin(sunDeclin * rad)) / (Math.cos(lat * rad) * Math.sin(zenith * rad));
    const azRad = Math.acos(Math.max(-1, Math.min(1, caz)));
    if (hourAngle > 0) {
        azimuth = (azRad * deg + 180) % 360;
    } else {
        azimuth = (540 - azRad * deg) % 360;
    }

    // Shadow direction is directly opposite of azimuth (180° offset)
    const shadowDirection = (azimuth + 180) % 360;

    // 16-point Compass Cardinals
    const cardinals = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const azIndex = Math.round(azimuth / 22.5) % 16;
    const shadowIndex = Math.round(shadowDirection / 22.5) % 16;

    return {
        elevation: parseFloat(elevation.toFixed(1)),
        azimuth: parseFloat(azimuth.toFixed(1)),
        azimuthCardinal: cardinals[azIndex],
        shadowDirection: parseFloat(shadowDirection.toFixed(1)),
        shadowCardinal: cardinals[shadowIndex],
        isDaylight: elevation > -0.833 // Standard apparent sunrise/sunset refraction limit
    };
}
