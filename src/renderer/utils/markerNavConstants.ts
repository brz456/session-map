// Epsilon for marker navigation boundary detection (seconds)
// Used to determine "at first/last marker" with tolerance for user convenience
export const MARKER_NAV_EPSILON_SEC = 0.1;

// Small tolerance for scan comparisons to handle seek imprecision (seconds)
// Much smaller than MARKER_NAV_EPSILON_SEC to allow closely-spaced marker navigation
export const SEEK_TOLERANCE_SEC = 0.01;

// Tolerance for treating playback time as "at marker time" for drawing mode (seconds)
export const DRAWING_SNAP_TOLERANCE_SEC = 0.15;
