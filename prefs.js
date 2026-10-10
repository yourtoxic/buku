import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {layout} from './src/layout.js';

// keys that change minimum pill width -> reset these first
const SIZE_KEYS = [
    'font-size', 'pill-height', 'battery-size', 'battery-style',
    'gap-pct-battery', 'gap-wave', 'padding-x',
];

export default class ButuPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const s = this.getSettings();
        window.set_default_size(600, 840);

        const sigIds = [];
        const watch = (key, fn) => sigIds.push(s.connect(`changed::${key}`, fn));
        window.connect('close-request', () => {
            sigIds.forEach(id => s.disconnect(id));
            return false;
        });

        const spin = (group, title, key, min, max, subtitle = '') => {
            const adj = new Gtk.Adjustment({
                lower: min, upper: max, step_increment: 1, page_increment: 5,
            });
            const row = new Adw.SpinRow({title, subtitle, adjustment: adj});
            s.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            group.add(row);
            return adj;
        };

        const toggle = (group, title, key, subtitle = '') => {
            const row = new Adw.SwitchRow({title, subtitle});
            s.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            group.add(row);
        };

        const combo = (group, title, key, items, subtitle = '') => {
            const row = new Adw.ComboRow({
                title,
                subtitle,
                model: Gtk.StringList.new(items.map(i => i[1])),
            });
            const idx = () => Math.max(0, items.findIndex(i => i[0] === s.get_string(key)));
            row.selected = idx();
            row.connect('notify::selected', () => {
                const v = items[row.selected][0];
                if (v !== s.get_string(key))
                    s.set_string(key, v);
            });
            watch(key, () => {
                if (row.selected !== idx())
                    row.selected = idx();
            });
            group.add(row);
        };

        const colorRow = (group, title, subtitle, key) => {
            const btn = new Gtk.ColorDialogButton({
                dialog: new Gtk.ColorDialog(),
                valign: Gtk.Align.CENTER,
            });
            const load = () => {
                const c = new Gdk.RGBA();
                c.parse(s.get_string(key));
                if (!btn.rgba || !btn.rgba.equal(c))
                    btn.rgba = c;
            };
            load();
            btn.connect('notify::rgba', () => {
                const v = btn.rgba.to_string();
                if (v !== s.get_string(key))
                    s.set_string(key, v);
            });
            watch(key, load);
            const row = new Adw.ActionRow({title, subtitle});
            row.add_suffix(btn);
            row.activatable_widget = btn;
            group.add(row);
        };

        // ================= Page 1: Charging =================
        const pCharge = new Adw.PreferencesPage({
            title: 'Charging',
            icon_name: 'battery-full-charging-symbolic',
        });

        const fx = new Adw.PreferencesGroup({
            title: 'Charging effect',
            description: 'Shown between the status text and the percentage, only while charging.',
        });
        toggle(fx, 'Charging animation', 'animation-enabled',
            'Off = flat line, saves a little power');
        combo(fx, 'Wave effect', 'wave-effect', [
            ['sine', 'Sine wave'],
            ['cosine', 'Cosine wave'],
            ['analog', 'Analog signal'],
            ['digital', 'Digital signal'],
            ['transverse', 'Transverse wave'],
            ['electromagnetic', 'Electromagnetic wave'],
            ['seismic', 'Seismic wave'],
            ['radio', 'Radio wave'],
            ['periodic', 'Periodic wave'],
        ]);
        toggle(fx, 'Reverse direction', 'wave-reverse',
            'Default: waves move forward, toward the percentage');
        pCharge.add(fx);

        const beh = new Adw.PreferencesGroup({title: 'Behavior'});
        toggle(beh, 'Stay expanded when fully charged', 'stay-expanded',
            'On = pill stays big while plugged in. Off = shrinks when full.');
        toggle(beh, 'Red battery on low charge', 'low-color-enabled', 'Only while discharging');
        spin(beh, 'Low battery level (%)', 'low-threshold', 5, 50);
        pCharge.add(beh);
        window.add(pCharge);

        // ================= Page 2: Look =================
        const pLook = new Adw.PreferencesPage({
            title: 'Look',
            icon_name: 'applications-graphics-symbolic',
        });

        const col = new Adw.PreferencesGroup({title: 'Color'});
        combo(col, 'Background', 'color-mode', [
            ['classic', 'Classic black'],
            ['wallpaper', 'Wallpaper color'],
            ['custom', 'Custom color'],
        ]);
        colorRow(col, 'Custom background', 'Used when Background = Custom color', 'custom-color');
        colorRow(col, 'Accent color', 'Percentage, battery and waves', 'accent-color');
        pLook.add(col);

        const bor = new Adw.PreferencesGroup({
            title: 'Dynamic border',
            description: 'Thin outline around the pill. Optional.',
        });
        toggle(bor, 'Enable border', 'border-enabled');
        combo(bor, 'Border color', 'border-mode', [
            ['state', 'Follow charge state'],
            ['level', 'Follow battery level (red to green)'],
            ['wallpaper', 'Wallpaper color'],
            ['custom', 'Custom color'],
        ]);
        colorRow(bor, 'Custom border color', 'Used when Border color = Custom', 'border-color');
        spin(bor, 'Border width (px)', 'border-width', 1, 4);
        spin(bor, 'Border opacity (%)', 'border-opacity', 10, 100);
        pLook.add(bor);

        const batG = new Adw.PreferencesGroup({title: 'Battery icon'});
        combo(batG, 'Style', 'battery-style', [
            ['ios', 'iOS'],
            ['oneui', 'One UI'],
            ['coloros', 'ColorOS'],
            ['emui', 'EMUI'],
            ['classic', 'Classic outline'],
            ['circle-cw', 'Circle (clockwise)'],
            ['circle-ccw', 'Circle (anticlockwise)'],
        ]);
        spin(batG, 'Icon size (px)', 'battery-size', 10, 60);
        pLook.add(batG);
        window.add(pLook);

        // ================= Page 3: Layout =================
        const pLay = new Adw.PreferencesPage({
            title: 'Layout',
            icon_name: 'view-grid-symbolic',
        });

        const size = new Adw.PreferencesGroup({
            title: 'Size',
            description: 'Minimum widths follow font, icon and spacing. Height is capped to panel height.',
        });
        const compAdj = spin(size, 'Compact width (px)', 'compact-width', 40, 160,
            'Pill while not charging');
        const expAdj = spin(size, 'Expanded width (px)', 'expanded-width', 140, 420,
            'Pill while charging');
        spin(size, 'Height (px)', 'pill-height', 18, 44);
        spin(size, 'Corner radius (px)', 'corner-radius', 0, 30);
        spin(size, 'Text size (px)', 'font-size', 9, 20);
        pLay.add(size);

        const updateMins = () => {
            const L = layout(s);
            compAdj.lower = L.minCompact;
            expAdj.lower = L.minExpanded;
            if (s.get_int('compact-width') < L.minCompact)
                s.set_int('compact-width', L.minCompact);
            if (s.get_int('expanded-width') < L.minExpanded)
                s.set_int('expanded-width', L.minExpanded);
        };

        const place = new Adw.PreferencesGroup({
            title: 'Placement inside pill',
            description: 'Move things in 1px steps. Positive X = right, positive Y = down.',
        });
        toggle(place, 'Battery icon before percentage', 'battery-first');
        spin(place, 'Inner padding left/right (px)', 'padding-x', 0, 40);
        spin(place, 'Space: percentage and battery (px)', 'gap-pct-battery', 0, 30);
        spin(place, 'Space: around wave (px)', 'gap-wave', 0, 30);
        pLay.add(place);

        const off = new Adw.PreferencesGroup({title: 'Fine offsets'});
        spin(off, 'Battery icon X', 'battery-offset-x', -40, 40);
        spin(off, 'Battery icon Y', 'battery-offset-y', -15, 15);
        spin(off, 'Percentage X', 'pct-offset-x', -40, 40);
        spin(off, 'Percentage Y', 'pct-offset-y', -15, 15);
        spin(off, 'Status text X', 'status-offset-x', -40, 40);
        spin(off, 'Status text Y', 'status-offset-y', -15, 15);
        pLay.add(off);

        const pos = new Adw.PreferencesGroup({title: 'Position in panel'});
        combo(pos, 'Panel area', 'position', [
            ['left', 'Left'],
            ['center', 'Center'],
            ['right', 'Right'],
        ]);
        spin(pos, 'Order in area', 'position-index', -1, 30, '0 = first, -1 = last');
        pLay.add(pos);

        updateMins();
        SIZE_KEYS.forEach(k => watch(k, updateMins));
        window.add(pLay);

        // ================= Page 4: Reset =================
        const pReset = new Adw.PreferencesPage({
            title: 'Reset',
            icon_name: 'edit-undo-symbolic',
        });
        const rg = new Adw.PreferencesGroup({title: 'Reset'});
        const resetBtn = new Gtk.Button({
            label: 'Reset',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        resetBtn.connect('clicked', () => {
            // size-related keys first so minimum-width limits relax before widths reset
            const keys = s.settings_schema.list_keys();
            SIZE_KEYS.forEach(k => s.reset(k));
            keys.filter(k => !SIZE_KEYS.includes(k)).forEach(k => s.reset(k));
        });
        const row = new Adw.ActionRow({
            title: 'Reset all settings',
            subtitle: 'Restore every option to default',
        });
        row.add_suffix(resetBtn);
        row.activatable_widget = resetBtn;
        rg.add(row);
        pReset.add(rg);
        window.add(pReset);
    }
}
