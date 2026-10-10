// Shared by pill.js and prefs.js so slider limits always match real minimum sizes.
// `s` is any object with get_int / get_string (Gio.Settings).
export function layout(s, hOverride) {
    const fs = s.get_int('font-size');
    const h = hOverride ?? s.get_int('pill-height');
    const style = s.get_string('battery-style');
    const size = s.get_int('battery-size');
    const gapPB = s.get_int('gap-pct-battery');
    const gapWave = s.get_int('gap-wave');
    const padX = s.get_int('padding-x');
    const circle = style.startsWith('circle');
    const maxH = Math.max(8, h - 4);

    let batW, batH;
    if (circle) {
        batW = batH = Math.min(Math.max(10, Math.round(size * 0.7)), maxH);
    } else {
        batW = size;
        batH = Math.min(Math.max(8, Math.round(size * 0.5)), maxH);
    }

    const pctW = Math.ceil(fs * 2.5);
    const textW = Math.ceil(fs * 0.62 * 8);
    const rightW = pctW + gapPB + batW;
    return {
        fs, h, circle, pctW, textW, batW, batH, gapPB, gapWave, padX, rightW,
        minCompact: rightW + 12,
        minExpanded: 2 * padX + rightW + textW + 2 * gapWave + 24,
    };
}
