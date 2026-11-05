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
    if (!(max > min)) return { domain: [0, Math.max(1, max)], ticks: [] };
    const pad = (max - min) * padRatio;
    let lo = min - pad;
    let hi = max + pad;
    const rawStep = (hi - lo) / count;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / magnitude;
    const step = (norm >= 5 ? 5 : norm >= 2.5 ? 2.5 : norm >= 2 ? 2 : 1) * magnitude;
    lo = Math.max(0, Math.floor(lo / step) * step);
    hi = Math.ceil(hi / step) * step;
    const ticks: number[] = [];
    for (let v = lo; v <= hi + step * 0.001; v += step) ticks.push(Math.round(v));
    return { domain: [Math.round(lo), Math.round(hi)], ticks };
}
