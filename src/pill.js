import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {parseColor, luminance, loadAverageColor} from './color.js';
import {GAP, PAD_X, layout} from './layout.js';

const EASE_MS = 350;
const PERIOD = 1400;      // wave cycle ms
const FRAME_MS = 33;      // ~30 fps, only while charging
const WAVE_LEN = 38;      // px per wave cycle
const LOW_RGB = {r: 255, g: 69, b: 58};
const BLACK = {r: 0, g: 0, b: 0};
const GREEN = {r: 88, g: 235, b: 98};
const BITS = [1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 1];
const AM = Clutter.AnimationMode;

function roundRect(cr, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    cr.newSubPath();
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
    cr.closePath();
}

export class ButuPill {
    constructor(settings, battery) {
        this._s = settings;
        this._battery = battery;
        this._destroyed = false;
        this._expanded = false;
        this._animating = false;
        this._frameId = 0;
        this._prevState = null;
        this._plugged = false;
        this._low = false;
        this._pct = 0;
        this._effect = settings.get_string('wave-effect');
        this._wallRgb = null;
        this._cancel = null;
        this._fgRgb = {r: 255, g: 255, b: 255};
        this._accRgb = GREEN;
        this._d = null;

        this._bgSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        this._ifaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});

        this._build();
        this._applyAll();
        this._mount();
        this._connect();
        this._refreshWallpaper();

        battery.onChange = () => this._sync();
        if (battery.ready)
            this._sync();
    }

    // ---------- build ----------

    _build() {
        const C = Clutter.ActorAlign;

        this.actor = new St.Widget({
            style_class: 'butu-container',
            layout_manager: new Clutter.BinLayout(),
            y_expand: true,
            y_align: C.FILL,
            x_align: C.CENTER,
            reactive: false,
            visible: false,
        });

        this._body = new St.Widget({
            style_class: 'butu-body',
            layout_manager: new Clutter.BinLayout(),
            clip_to_allocation: true,
            y_expand: true,
            y_align: C.CENTER,
            x_align: C.CENTER,
        });

        this._row = new St.BoxLayout({
            x_expand: true, y_expand: true, x_align: C.CENTER, y_align: C.CENTER,
        });

        // left part: "Charging" + wave. Collapses to 0 width in compact mode.
        this._extras = new St.BoxLayout({
            clip_to_allocation: true, y_align: C.CENTER, opacity: 0,
        });
        this._status = new St.Label({
            style_class: 'butu-status', y_align: C.CENTER, text: 'Charging',
        });
        this._wave = new St.DrawingArea({x_expand: true, y_expand: true, y_align: C.CENTER});
        this._wave.connect('repaint', a => this._drawWave(a));
        this._extras.add_child(this._status);
        this._extras.add_child(this._wave);

        // right part: percent + battery. Always visible.
        this._right = new St.BoxLayout({y_align: C.CENTER});
        this._pctLabel = new St.Label({
            style_class: 'butu-pct', y_align: C.CENTER, text: '0%',
        });
        this._spacer = new St.Widget();
        this._bat = new St.DrawingArea({y_align: C.CENTER});
        this._bat.connect('repaint', a => this._drawBattery(a));
        this._right.add_child(this._pctLabel);
        this._right.add_child(this._spacer);
        this._right.add_child(this._bat);

        this._row.add_child(this._extras);
        this._row.add_child(this._right);
        this._body.add_child(this._row);
        this.actor.add_child(this._body);
    }

    _dims() {
        const s = this._s;
        const fs = s.get_int('font-size');
        let h = s.get_int('pill-height');
        const ph = Main.panel.height;
        if (ph > 0)
            h = Math.max(18, Math.min(h, ph - 2)); // never taller than panel, avoids clipping
        const L = layout(fs, h);
        const cw = Math.max(s.get_int('compact-width'), L.minCompact);
        const ew = Math.max(s.get_int('expanded-width'), L.minExpanded);
        const extrasW = ew - 2 * PAD_X - L.rightW;
        const waveW = Math.max(10, extrasW - L.textW - 2 * GAP);
        return {fs, h, cw, ew, extrasW, waveW, ...L};
    }

    _applyAll() {
        const d = this._d = this._dims();
        this._body.remove_all_transitions();
        this._extras.remove_all_transitions();

        this._body.set_height(d.h);
        this._body.set_width(this._expanded ? d.ew : d.cw);
        this._extras.set_width(this._expanded ? d.extrasW : 0);
        this._extras.opacity = this._expanded ? 255 : 0;
        this._status.set_width(d.textW);
        this._wave.set_size(d.waveW, Math.max(8, d.h - 10));
        this._pctLabel.set_width(d.pctW);
        this._spacer.set_width(GAP);
        this._bat.set_size(d.batW, d.batH);

        this._applyStyles();
        this._setPercent(this._battery.percent);
        this.actor.queue_relayout();
    }

    // ---------- colors ----------

    _resolveBg() {
        const mode = this._s.get_string('color-mode');
        if (mode === 'wallpaper')
            return this._wallRgb ?? BLACK;
        if (mode === 'custom')
            return parseColor(this._s.get_string('custom-color'));
        return BLACK;
    }

    _stateColor() {
        if (this._low)
            return LOW_RGB;
        return this._plugged ? this._accRgb : this._fgRgb;
    }

    _applyStyles() {
        if (this._destroyed || !this._d)
            return;
        const d = this._d;
        const bg = this._resolveBg();
        const fg = this._fgRgb = luminance(bg) > 0.62
            ? {r: 20, g: 20, b: 20}
            : {r: 255, g: 255, b: 255};
        this._accRgb = parseColor(this._s.get_string('accent-color'), GREEN);
        const st = this._stateColor();
        const radius = Math.min(this._s.get_int('corner-radius'), Math.floor(d.h / 2));

        this._body.set_style(
            `background-color: rgb(${bg.r},${bg.g},${bg.b}); border-radius: ${radius}px;`);
        this._status.set_style(
            `color: rgb(${fg.r},${fg.g},${fg.b}); font-size: ${d.fs}px;`);
        this._pctLabel.set_style(
            `color: rgb(${st.r},${st.g},${st.b}); font-size: ${d.fs}px;`);
        this._wave.set_style(`margin: 0 ${GAP}px;`);
        this._bat.queue_repaint();
        this._wave.queue_repaint();
    }

    _refreshWallpaper() {
        if (this._destroyed || this._s.get_string('color-mode') !== 'wallpaper')
            return;
        this._cancel?.cancel();
        const dark = this._ifaceSettings.get_string('color-scheme') === 'prefer-dark';
        let uri = this._bgSettings.get_string(dark ? 'picture-uri-dark' : 'picture-uri');
        if (!uri)
            uri = this._bgSettings.get_string('picture-uri');
        if (!uri || uri === 'none') {
            this._wallRgb = null;
            this._applyStyles();
            return;
        }
        const c = this._cancel = new Gio.Cancellable();
        loadAverageColor(uri, c, rgb => {
            if (c.is_cancelled() || this._destroyed)
                return;
            this._wallRgb = rgb;
            this._applyStyles();
        });
    }

    // ---------- drawing ----------

    _drawBattery(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const c = this._stateColor();
        const nubW = Math.max(2, Math.round(w * 0.09));
        const bw = w - nubW - 1;
        const r = Math.max(2, h * 0.28);

        roundRect(cr, 0, 0, bw, h, r);
        cr.setSourceRGBA(c.r / 255, c.g / 255, c.b / 255, 0.28);
        cr.fillPreserve();
        cr.save();
        cr.clip();
        cr.setSourceRGBA(c.r / 255, c.g / 255, c.b / 255, 1);
        cr.rectangle(0, 0, bw * this._pct / 100, h);
        cr.fill();
        cr.restore();

        cr.setSourceRGBA(c.r / 255, c.g / 255, c.b / 255, this._pct >= 99 ? 1 : 0.28);
        roundRect(cr, bw + 1, h * 0.3, nubW, h * 0.4, nubW / 2);
        cr.fill();
        cr.$dispose();
    }

    _drawWave(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const c = this._accRgb;
        const mid = h / 2;
        const amp = Math.max(2, h / 2 - 2);
        const k = 2 * Math.PI / WAVE_LEN;
        const ms = GLib.get_monotonic_time() / 1000;
        const t = (ms % PERIOD) / PERIOD * 2 * Math.PI;
        const env = x => Math.sin(Math.PI * x / w);   // taper at both ends

        cr.setLineWidth(1.8);
        cr.setLineCap(1);
        cr.setLineJoin(1);

        const trace = fn => {
            cr.newPath();
            for (let x = 0; x <= w; x += 2) {
                const y = mid - amp * env(x) * fn(x);
                if (x === 0) cr.moveTo(x, y); else cr.lineTo(x, y);
            }
            cr.stroke();
        };

        if (!this._animating) {
            // idle: flat faint line, drawn once
            cr.setSourceRGBA(c.r / 255, c.g / 255, c.b / 255, 0.35);
            cr.moveTo(0, mid);
            cr.lineTo(w, mid);
            cr.stroke();
            cr.$dispose();
            return;
        }

        switch (this._effect) {
        case 'cosine':
            cr.setSourceRGBA(c.r / 255, c.g / 255, c.b / 255, 0.3);
            trace(x => 0.7 * Math.cos(k * x + t + 1.3));
            cr.setSourceRGBA(c.r / 255, c.g / 255, c.b / 255, 1);
            trace(x => Math.cos(k * x + t));
            break;
        case 'analog':
            cr.setSourceRGBA(c.r / 255, c.g / 255, c.b / 255, 1);
            trace(x => 0.55 * Math.sin(k * x - t) +
                0.3 * Math.sin(2.3 * k * x - 1.7 * t + 0.8) +
                0.15 * Math.sin(5.1 * k * x - 2.9 * t) +
                0.06 * Math.sin(1.9 * x + 3 * t));
            break;
        case 'digital': {
            cr.setSourceRGBA(c.r / 255, c.g / 255, c.b / 255, 1);
            cr.setLineJoin(0);
            cr.setLineCap(0);
            const bitW = Math.max(6, Math.round(h * 0.55));
            const N = BITS.length;
            const hi = mid - amp * 0.8;
            const lo = mid + amp * 0.8;
            const pos = ((ms / 1000) * bitW * 3) % (bitW * N);
            let x = -(pos % bitW);
            let first = true;
            cr.newPath();
            for (let i = Math.floor(pos / bitW); x < w; i++, x += bitW) {
                const y = BITS[i % N] ? hi : lo;
                const x0 = Math.max(0, x);
                const x1 = Math.min(w, x + bitW);
                if (first) { cr.moveTo(x0, y); first = false; } else { cr.lineTo(x0, y); }
                cr.lineTo(x1, y);
            }
            cr.stroke();
            break;
        }
        default: // sine
            cr.setSourceRGBA(c.r / 255, c.g / 255, c.b / 255, 1);
            trace(x => Math.sin(k * x - t));
        }
        cr.$dispose();
    }

    // ---------- state ----------

    _sync() {
        if (this._destroyed || !this._battery.ready)
            return;
        const {percent, state, present} = this._battery;
        this.actor.visible = present;
        if (!present) {
            this._stopAnim();
            this._prevState = null;
            return;
        }

        const s = this._s;
        const plugged = state === 1 || state === 4 || state === 5;
        const low = !plugged && s.get_boolean('low-color-enabled') &&
            percent <= s.get_int('low-threshold');
        const changed = plugged !== this._plugged || low !== this._low;
        this._plugged = plugged;
        this._low = low;

        this._status.text = state === 1 ? 'Charging' : state === 4 ? 'Charged' : 'Plugged';
        this._setPercent(percent);
        if (changed)
            this._applyStyles();

        const wantExpanded = state === 1 ||
            ((state === 4 || state === 5) && s.get_boolean('stay-expanded'));
        if (wantExpanded)
            this._expand();
        else
            this._compact();

        if (state === 1)
            this._startAnim();
        else
            this._stopAnim();

        this._prevState = state;
    }

    _setPercent(p) {
        this._pct = Math.max(0, Math.min(100, p));
        this._pctLabel.text = `${Math.round(this._pct)}%`;
        this._bat.queue_repaint();
    }

    _expand() {
        if (this._expanded)
            return;
        this._expanded = true;
        const d = this._d;
        this._body.ease({width: d.ew, duration: EASE_MS, mode: AM.EASE_OUT_QUAD});
        this._extras.ease({width: d.extrasW, opacity: 255, duration: EASE_MS, mode: AM.EASE_OUT_QUAD});
    }

    _compact() {
        if (!this._expanded)
            return;
        this._expanded = false;
        const d = this._d;
        this._body.ease({width: d.cw, duration: EASE_MS - 50, mode: AM.EASE_OUT_QUAD});
        this._extras.ease({width: 0, opacity: 0, duration: EASE_MS - 50, mode: AM.EASE_OUT_QUAD});
    }

    // ---------- animation: only while charging ----------

    _startAnim() {
        if (this._animating || !this._s.get_boolean('animation-enabled'))
            return;
        this._animating = true;
        this._frameId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FRAME_MS, () => {
            if (this._destroyed || !this._animating) {
                this._frameId = 0;
                return GLib.SOURCE_REMOVE;
            }
            if (this._wave.mapped)
                this._wave.queue_repaint();
            return GLib.SOURCE_CONTINUE;
        });
        GLib.Source.set_name_by_id(this._frameId, '[butu] wave frame');
    }

    _stopAnim() {
        const was = this._animating;
        this._animating = false;
        if (this._frameId) {
            GLib.Source.remove(this._frameId);
            this._frameId = 0;
        }
        if (was && !this._destroyed)
            this._wave.queue_repaint();
    }

    // ---------- panel + signals ----------

    _mount() {
        const panel = Main.panel;
        const boxes = {left: panel._leftBox, center: panel._centerBox, right: panel._rightBox};
        const box = boxes[this._s.get_string('position')] ?? panel._centerBox;
        this.actor.get_parent()?.remove_child(this.actor);
        box.insert_child_at_index(this.actor, this._s.get_int('position-index'));
    }

    _connect() {
        const relayout = () => this._applyAll();
        const restyle = () => this._applyStyles();
        const resync = () => this._sync();
        this._s.connectObject(
            'changed::compact-width', relayout,
            'changed::expanded-width', relayout,
            'changed::pill-height', relayout,
            'changed::font-size', relayout,
            'changed::corner-radius', restyle,
            'changed::custom-color', restyle,
            'changed::accent-color', restyle,
            'changed::color-mode', () => {
                this._refreshWallpaper();
                this._applyStyles();
            },
            'changed::wave-effect', () => {
                this._effect = this._s.get_string('wave-effect');
                this._wave.queue_repaint();
            },
            'changed::position', () => this._mount(),
            'changed::position-index', () => this._mount(),
            'changed::animation-enabled', () => {
                this._stopAnim();
                this._sync();
            },
            'changed::stay-expanded', resync,
            'changed::low-color-enabled', resync,
            'changed::low-threshold', resync,
            this);

        const wall = () => this._refreshWallpaper();
        this._bgSettings.connectObject(
            'changed::picture-uri', wall,
            'changed::picture-uri-dark', wall,
            this);
        this._ifaceSettings.connectObject('changed::color-scheme', wall, this);
    }

    destroy() {
        if (this._destroyed)
            return;
        this._stopAnim();
        this._destroyed = true;
        this._battery.onChange = null;
        this._cancel?.cancel();
        this._cancel = null;
        this._s.disconnectObject(this);
        this._bgSettings.disconnectObject(this);
        this._ifaceSettings.disconnectObject(this);
        this._body.remove_all_transitions();
        this._extras.remove_all_transitions();
        this.actor.get_parent()?.remove_child(this.actor);
        this.actor.destroy();
        this.actor = null;
        this._bgSettings = null;
        this._ifaceSettings = null;
        this._s = null;
        this._battery = null;
    }
}
