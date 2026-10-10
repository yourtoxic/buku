import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {Battery} from './src/battery.js';
import {ButuPill} from './src/pill.js';

export default class ButuExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._battery = new Battery();
        this._pill = new ButuPill(this._settings, this._battery);
    }

    disable() {
        this._pill?.destroy();
        this._pill = null;
        this._battery?.destroy();
        this._battery = null;
        this._settings = null;
    }
}
