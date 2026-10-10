import Gio from 'gi://Gio';

const IFACE = `<node>
  <interface name="org.freedesktop.UPower.Device">
    <property name="Percentage" type="d" access="read"/>
    <property name="State" type="u" access="read"/>
    <property name="IsPresent" type="b" access="read"/>
  </interface>
</node>`;

const UPowerProxy = Gio.DBusProxy.makeProxyWrapper(IFACE);
const DISPLAY_DEVICE = '/org/freedesktop/UPower/devices/DisplayDevice';

// UPower states: 1 charging, 2 discharging, 3 empty, 4 fully-charged,
// 5 pending-charge, 6 pending-discharge.
export class Battery {
    constructor() {
        this.ready = false;
        this.percent = 0;
        this.state = 0;
        this.present = false;
        this.onChange = null;

        this._proxy = null;
        this._sigId = 0;
        this._dead = false;

        new UPowerProxy(Gio.DBus.system, 'org.freedesktop.UPower', DISPLAY_DEVICE,
            (proxy, error) => {
                if (this._dead)
                    return;
                if (error) {
                    console.error(`[Butu] UPower proxy error: ${error.message}`);
                    return;
                }
                this._proxy = proxy;
                this._sigId = proxy.connect('g-properties-changed', () => this._read());
                this.ready = true;
                this._read(true);
            });
    }

    _read(force = false) {
        const p = this._proxy;
        if (!p)
            return;
        const percent = Math.round(p.Percentage ?? 0);
        const state = p.State ?? 0;
        const present = p.IsPresent ?? false;
        if (!force && percent === this.percent && state === this.state && present === this.present)
            return;
        this.percent = percent;
        this.state = state;
        this.present = present;
        this.onChange?.();
    }

    destroy() {
        this._dead = true;
        this.onChange = null;
        if (this._proxy && this._sigId)
            this._proxy.disconnect(this._sigId);
        this._sigId = 0;
        this._proxy = null;
    }
}
