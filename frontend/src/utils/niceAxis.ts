/**
 * Clean, round Y-axis: pads the data range, then snaps the domain and ticks to
 * nice round steps (1 / 2 / 2.5 / 5 × 10ⁿ) so labels read $400萬 / $550萬
 * instead of $340.7萬 / $540.7萬. `padRatio` is the share of the data range
 * added above and below.
 */
export function niceAxis(
    min: number,
    max: number,
    { count = 4, padRatio = 0.08 }: { count?: number; padRatio?: number } = {},
): { domain: [number, number]; ticks: number[] } {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
        return { domain: [0, 1], ticks: [] };
    }
    // A flat series (one point, or a value that never moves) gets a band around
    // its value; a 0-based axis with no ticks squashed it against the top.
    const pad = max > min ? (max - min) * padRatio : Math.abs(max) * 0.05 || 1;
    let lo = min - pad;
    let hi = max + pad;
    const rawStep = (hi - lo) / count;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / magnitude;
    const step = (norm >= 5 ? 5 : norm >= 2.5 ? 2.5 : norm >= 2 ? 2 : 1) * magnitude;
    // Floors at 0 only for non-negative data: a negative net worth must stay visible.
    lo = Math.floor(lo / step) * step;
    if (min >= 0) lo = Math.max(0, lo);
    hi = Math.ceil(hi / step) * step;
    const ticks: number[] = [];
    for (let v = lo; v <= hi + step * 0.001; v += step) ticks.push(Math.round(v));
    return { domain: [Math.round(lo), Math.round(hi)], ticks };
}
