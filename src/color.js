import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';

const DEFAULT = {r: 53, g: 132, b: 228};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function parseColor(str, fallback = DEFAULT) {
    if (typeof str !== 'string')
        return fallback;
    let m = str.match(/^#([0-9a-f]{6})$/i);
    if (m) {
        const v = parseInt(m[1], 16);
        return {r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255};
    }
    m = str.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m)
        return {r: clamp(+m[1], 0, 255), g: clamp(+m[2], 0, 255), b: clamp(+m[3], 0, 255)};
    return fallback;
}

export function luminance({r, g, b}) {
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function rgbToHsl({r, g, b}) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h /= 6;
    }
    return {h, s, l};
}

function hslToRgb({h, s, l}) {
    if (s === 0) {
        const v = Math.round(l * 255);
        return {r: v, g: v, b: v};
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = t => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return {
        r: Math.round(f(h + 1 / 3) * 255),
        g: Math.round(f(h) * 255),
        b: Math.round(f(h - 1 / 3) * 255),
    };
}

// Make averaged wallpaper color look good as a pill: keep it readable, not muddy.
function tune(rgb) {
    const hsl = rgbToHsl(rgb);
    hsl.l = clamp(hsl.l, 0.28, 0.5);
    if (hsl.s > 0.08)
        hsl.s = Math.min(1, Math.max(hsl.s, 0.35) * 1.15);
    return hslToRgb(hsl);
}

function average(pixbuf) {
    const w = pixbuf.get_width();
    const h = pixbuf.get_height();
    const n = pixbuf.get_n_channels();
    const stride = pixbuf.get_rowstride();
    const px = pixbuf.get_pixels();
    let r = 0, g = 0, b = 0, count = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * stride + x * n;
            r += px[i]; g += px[i + 1]; b += px[i + 2];
            count++;
        }
    }
    if (!count)
        return null;
    return tune({r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count)});
}

// Async, tiny 48px decode, result passed to cb(rgb | null).
export function loadAverageColor(uri, cancellable, cb) {
    let file;
    try {
        file = Gio.File.new_for_uri(uri);
    } catch (_e) {
        cb(null);
        return;
    }
    file.read_async(GLib.PRIORITY_LOW, cancellable, (f, res) => {
        let stream;
        try {
            stream = f.read_finish(res);
        } catch (_e) {
            cb(null);
            return;
        }
        GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, 48, 48, true, cancellable, (_o, r) => {
            let rgb = null;
            try {
                const pb = GdkPixbuf.Pixbuf.new_from_stream_finish(r);
                rgb = pb ? average(pb) : null;
            } catch (_e) {
                rgb = null;
            }
            stream.close_async(GLib.PRIORITY_LOW, null, (s, rr) => {
                try { s.close_finish(rr); } catch (_e) { /* ignore */ }
            });
            cb(rgb);
        });
    });
}

export function lighten(rgb) {
    const hsl = rgbToHsl(rgb);
    hsl.l = Math.min(0.75, hsl.l + 0.25);
    return hslToRgb(hsl);
}

// 0% red -> 100% green
export function levelColor(p) {
    return hslToRgb({h: clamp(p, 0, 1) * 0.33, s: 0.85, l: 0.55});
}
