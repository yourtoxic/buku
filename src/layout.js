// Shared by pill.js and prefs.js so slider limits always match real minimum sizes.
export const GAP = 6;
export const PAD_X = 14;

export function layout(fs, h) {
    const pctW = Math.ceil(fs * 2.5);
    const batW = Math.max(18, Math.min(40, Math.round(h * 0.9)));
    const batH = Math.max(9, Math.round(batW * 0.5));
    const rightW = pctW + GAP + batW;
    const textW = Math.ceil(fs * 0.62 * 8);
    return {
        pctW, batW, batH, rightW, textW,
        minCompact: rightW + 12,
        minExpanded: 2 * PAD_X + rightW + textW + 2 * GAP + 24,
    };
}
