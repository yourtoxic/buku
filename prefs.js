import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {layout} from './src/layout.js';

export default class ButuPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const s = this.getSettings();
        window.set_default_size(580, 820);

        const sigIds = [];
        const watch = (key, fn) => sigIds.push(s.connect(`changed::${key}`, fn));
        window.connect('close-request', () => {
            sigIds.forEach(id => s.disconnect(id));
            return false;
        });

        const page = new Adw.PreferencesPage({
            title: 'Butu',
            icon_name: 'battery-full-charging-symbolic',
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

        // Charging effects
        const fxGroup = new Adw.PreferencesGroup({
            title: 'Charging effect',
            description: 'Shown between the status text and the percentage, only while charging.',
        });
        toggle(fxGroup, 'Charging animation', 'animation-enabled',
            'Off = flat line, saves a little power');
        combo(fxGroup, 'Wave effect', 'wave-effect', [
            ['sine', 'Sine wave'],
            ['cosine', 'Cosine wave'],
            ['analog', 'Analog signal'],
            ['digital', 'Digital signal'],
        ]);
        toggle(fxGroup, 'Stay expanded when fully charged', 'stay-expanded',
            'On = pill stays big while plugged in. Off = shrinks when full.');
        page.add(fxGroup);

        // Color
        const colorGroup = new Adw.PreferencesGroup({title: 'Color'});
        combo(colorGroup, 'Background', 'color-mode', [
            ['classic', 'Classic black'],
            ['wallpaper', 'Wallpaper color'],
            ['custom', 'Custom color'],
        ]);
        colorRow(colorGroup, 'Custom background', 'Used when Background = Custom color',
            'custom-color');
        colorRow(colorGroup, 'Accent color', 'Percentage, battery and waves', 'accent-color');
        toggle(colorGroup, 'Red battery on low charge', 'low-color-enabled',
            'Only while discharging');
        spin(colorGroup, 'Low battery level (%)', 'low-threshold', 5, 50);
        page.add(colorGroup);

        // Size
        const sizeGroup = new Adw.PreferencesGroup({
            title: 'Size',
            description: 'Minimum widths follow font size and height. Height is capped to panel height.',
        });
        const compAdj = spin(sizeGroup, 'Compact width (px)', 'compact-width', 40, 160,
            'Pill while not charging');
        const expAdj = spin(sizeGroup, 'Expanded width (px)', 'expanded-width', 140, 420,
            'Pill while charging');
        spin(sizeGroup, 'Height (px)', 'pill-height', 18, 44);
        spin(sizeGroup, 'Corner radius (px)', 'corner-radius', 0, 30);
        spin(sizeGroup, 'Font size (px)', 'font-size', 9, 20);
        page.add(sizeGroup);

        const updateMins = () => {
            const L = layout(s.get_int('font-size'), s.get_int('pill-height'));
            compAdj.lower = L.minCompact;
            expAdj.lower = L.minExpanded;
            if (s.get_int('compact-width') < L.minCompact)
                s.set_int('compact-width', L.minCompact);
            if (s.get_int('expanded-width') < L.minExpanded)
                s.set_int('expanded-width', L.minExpanded);
        };
        updateMins();
        watch('font-size', updateMins);
        watch('pill-height', updateMins);

        // Position
        const posGroup = new Adw.PreferencesGroup({title: 'Position'});
        combo(posGroup, 'Panel area', 'position', [
            ['left', 'Left'],
            ['center', 'Center'],
            ['right', 'Right'],
        ]);
        spin(posGroup, 'Order in area', 'position-index', -1, 30, '0 = first, -1 = last');
        page.add(posGroup);

        // Reset
        const resetGroup = new Adw.PreferencesGroup({title: 'Reset'});
        const resetBtn = new Gtk.Button({
            label: 'Reset',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        resetBtn.connect('clicked', () => {
            // font + height first so size limits relax before widths reset
            const first = ['font-size', 'pill-height'];
            const keys = s.settings_schema.list_keys();
            first.forEach(k => s.reset(k));
            keys.filter(k => !first.includes(k)).forEach(k => s.reset(k));
        });
        const resetRow = new Adw.ActionRow({
            title: 'Reset all settings',
            subtitle: 'Restore every option to default',
        });
        resetRow.add_suffix(resetBtn);
        resetRow.activatable_widget = resetBtn;
        resetGroup.add(resetRow);
        page.add(resetGroup);

        window.add(page);
    }
}
