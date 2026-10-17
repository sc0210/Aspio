/**
 * When an asset is "off target", in percentage points (|current% − target%|).
 *
 * The backend's rebalancing service holds an asset at `abs(deviation) <= 5.0` and
 * only plans a trade above it (`deviation_threshold` in rebalancing_service.py), so
 * off target is strictly greater: at exactly 5 points the UI alarmed with no trade
 * behind it. Desktop (AssetAllocationCard) and phone (MobileRebalancing) both read
 * this, so they cannot disagree about the same portfolio again.
 */
const OFF_TARGET_POINTS = 5;
/** Amber "drifting" band below the threshold; colour only, no trade implied. */
const NEAR_TARGET_POINTS = 3;

/** Absorbs float noise only (55.0000001% against 50%). Rounding to 0.01 instead
 *  missed a real 5.004-point drift the backend, which compares unrounded, trades. */
const EPS = 1e-6;

export const isOffTarget = (points: number) => Math.abs(points) > OFF_TARGET_POINTS + EPS;
export const isNearTarget = (points: number) => !isOffTarget(points) && Math.abs(points) >= NEAR_TARGET_POINTS - EPS;
