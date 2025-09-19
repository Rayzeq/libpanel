import Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import GObject from "gi://GObject";

import { InjectionManager } from "resource:///org/gnome/shell/extensions/extension.js";
import { EventEmitter } from "resource:///org/gnome/shell/misc/signals.js";
import { PopupAnimation } from "resource:///org/gnome/shell/ui/boxpointer.js";
import type { ExtensionManager, ExtensionObject } from "resource:///org/gnome/shell/ui/extensionSystem.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import type { Panel as GnomePanel, QuickSettings } from "resource:///org/gnome/shell/ui/panel.js";
import { QuickSettingsMenu, type QuickSettingsItem, type QuickSettingsLayout } from "resource:///org/gnome/shell/ui/quickSettings.js";

import type { Panel as DtpPanel } from "./dash_to_panel.js";
import PanelGridMenu from "./menu.js";
import Panel, { QuickSettingsPanelInterface } from "./panel.js";
import {
	current_extension_uuid,
	get_settings,
	rsplit,
	split,
} from "./utils.js";

export { Panel };
export const VERSION = 2;

declare module "resource:///org/gnome/shell/ui/panel.js" {
	interface Panel {
		_libpanel?: LibPanel;
	}
}

declare module "resource:///org/gnome/shell/ui/quickSettings.js" {
	interface QuickSettingsMenu extends QuickSettingsPanelInterface {}
}

// Patching the default menu to have the exact same API as the one from `Panel`.
// This way, extensions can use them the same way.
QuickSettingsMenu.prototype.getItems = function (): Clutter.Actor[] {
	return this._grid.get_children().filter(item => item != (this._grid.layout_manager as QuickSettingsLayout)._overlay);
};
QuickSettingsMenu.prototype.removeItem = function (item: Clutter.Actor | QuickSettingsItem) {
	this._grid.remove_child(item);
	if ("menu" in item && item.menu) {
		for (const id of item.menu._signalConnectionsByName?.["open-state-changed"] || []) {
			if (item.menu._signalConnections![id].callback.toString().includes("this._setDimmed")) {
				item.menu.disconnect(id);
			}
		}

		this._overlay.remove_child(item.menu.actor);
	}
};
QuickSettingsMenu.prototype.getColumnSpan = function (item) {
	const value = new GObject.Value();
	this._grid.layout_manager.child_get_property(this._grid, item, "column-span", value);
	const column_span = value.get_int();
	value.unset();
	return column_span;
};
QuickSettingsMenu.prototype.setColumnSpan = function (item, column_span: number) {
	this._grid.layout_manager.child_set_property(this._grid, item, "column-span", column_span);
};

export class LibPanel extends EventEmitter {
	public static get_instance(): LibPanel | undefined {
		return Main.panel._libpanel;
	}

	public static get VERSION(): number {
		return LibPanel.get_instance()?.VERSION || VERSION;
	}

	public static get main_panel() {
		return LibPanel.get_instance()?.main_panel || Main.panel.statusArea.quickSettings;
	}

	public static get enablers() {
		return LibPanel.get_instance()?.enablers || [];
	}

	public static get enabled() {
		return LibPanel.enablers.length !== 0;
	}

	public static async enable() {
		const uuid = current_extension_uuid();
		if (!uuid) {
			console.error("[LibPanel] libpanel wasn't directly enabled from extension code. It will not be enabled.");
			return;
		}

		let instance = LibPanel.get_instance();
		// DO NOT TRUST THE WARNING: typescript still doesn't support async constructors after 7 years..., nor does it support @ts-expect-warning
		if (!instance) instance = Main.panel._libpanel = await new LibPanel();
		if (instance.VERSION != VERSION)
			console.warn(`[LibPanel] ${current_extension_uuid()} depends on libpanel ${VERSION} but libpanel ${instance.VERSION} is loaded`);
		if (instance.enablers.indexOf(uuid) < 0) instance.enablers.push(uuid);
	}

	public static disable() {
		const instance = LibPanel.get_instance();
		if (!instance) return;

		const uuid = current_extension_uuid();
		if (!uuid) {
			console.error("[LibPanel] libpanel wasn't directly disabled from extension code. It will not be disabled.");
			return;
		}

		const index = instance.enablers.indexOf(uuid);
		if (index > -1) instance.enablers.splice(index, 1);

		if (instance.enablers.length === 0) {
			instance.destroy();
			delete Main.panel._libpanel;
		};
	}

	public static addPanel(panel: Panel, instance?: LibPanel) {
		instance = instance || LibPanel.get_instance();
		if (!instance) {
			console.error(`[LibPanel] ${current_extension_uuid()} tried to add a panel, but the library is disabled.`);
			return;
		}

		return;
		instance._panel_grid.add_panel(panel);

		// if (instance._panel_grid.box.get_children().length > 1) {
		// 	instance._panel_grid.box.layout_manager.child_set_property(instance._panel_grid.box, panel, "column", 1);
		// 	instance._panel_grid.box.layout_manager.child_set_property(instance._panel_grid.box, panel, "row", 0);

		// 	let w = new St.Widget({ min_width: 20, natural_width: 100, min_height: 100, natural_height: 100, style: "background-color: cyan" });
		// 	instance._panel_grid.box.add_child(w);
		// 	instance._panel_grid.box.layout_manager.child_set_property(instance._panel_grid.box, w, "column", 1);
		// 	instance._panel_grid.box.layout_manager.child_set_property(instance._panel_grid.box, w, "row", 1);

		// 	w = new St.Widget({ min_width: 20, natural_width: 100, min_height: 100, natural_height: 100, style: "background-color: red" });
		// 	instance._panel_grid.box.add_child(w);
		// 	instance._panel_grid.box.layout_manager.child_set_property(instance._panel_grid.box, w, "column", -2);

		// 	// w = new St.Widget({ min_width: 100, natural_width: 150, min_height: 100, natural_height: 100, style: "background-color: blue" });
		// 	// this._boxPointer.bin.first_child.add_child(w);
		// 	// this._boxPointer.bin.first_child.layout_manager.child_set_property(this._boxPointer.bin.first_child, w, "column", -2);

		// 	w = new St.Widget({ min_width: 400, natural_width: 500, min_height: 100, natural_height: 100, style: "background-color: yellow" });
		// 	instance._panel_grid.box.add_child(w);
		// 	instance._panel_grid.box.layout_manager.child_set_property(instance._panel_grid.box, w, "column", 2);

		// 	w = new St.Widget({ min_width: 400, natural_width: 500, min_height: 100, natural_height: 100, style: "background-color: green" });
		// 	instance._panel_grid.box.add_child(w);
		// 	instance._panel_grid.box.layout_manager.child_set_property(instance._panel_grid.box, w, "column", 3);

		// }
	}

	public static removePanel(panel) {
		panel._keep_layout = true;
		panel.get_parent()?.remove_child(panel);
		panel._keep_layout = undefined;
	}

	private VERSION: number = VERSION;

	private enablers: string[];
	private injection_manager: InjectionManager;
	private settings: Gio.Settings;
	// @ts-expect-error: typescript still doesn't support async constructors after 7 years...
	private main_panel: Panel;

	constructor() {
		super();
		this.enablers = [];
		this.injection_manager = new InjectionManager();

		const this_path = "/" + split(rsplit(import.meta.url, "/", 1)[0], "/", 3)[3];
		this.settings = get_settings(`${this_path}/org.gnome.shell.extensions.libpanel.gschema.xml`);

		this.injection_manager.overrideMethod(Main.panel.statusArea.quickSettings.constructor.prototype, "_setupIndicators", wrapped => function (this: QuickSettings) {
			const promise = wrapped.call(this);
			// @ts-expect-error: hack
			this.__setup_promise = promise.then(() => delete this.__setup_promise);
			return promise;
		});

		// @ts-expect-error: typescript still doesn't support async constructors after 7 years...
		return (async () => {
			this.main_panel = await this.patch_menu(Main.panel, Main.layoutManager.findIndexForActor(Main.panel));
			const patch_dash_to_panel = async () => {
				if (global.dashToPanel)
					if (global.dashToPanel.panels)
						for (const panel of global.dashToPanel.panels) {
							await this.patch_menu(panel, panel.monitor.index);
						}
					else
						global.dashToPanel.connect_object("panels-created", async () => {
							for (const panel of global.dashToPanel!.panels!) {
								await this.patch_menu(panel, panel.monitor.index);
							}
							return false;
						}, this);
			};
		
			await patch_dash_to_panel();
			Main.extensionManager.connect_object("extension-state-changed", (_: ExtensionManager, extension: ExtensionObject) => {
				if (extension.uuid === "dash-to-panel@jderose9.github.com" && extension.enabled) {
					patch_dash_to_panel().catch(e => console.error(e));
				}
				return false;
			}, this);

			return this;
		})().catch(e => console.error(e));
	}

	private destroy() {
		if (global.dashToPanel) global.dashToPanel.disconnect_object(this);
		Main.extensionManager.disconnect_object(this);

		this.injection_manager.clear();

		// Unpatch all panels
		this.emit("destroy");
		this.disconnectAll();
	}

	private async patch_menu(panel: GnomePanel | DtpPanel, monitor: number): Promise<Panel> {
		const quickSettings = panel.statusArea.quickSettings;
		const menu = quickSettings.menu;
		// prevent double-patch
		// @ts-expect-error: menu isn't supposed to be anything else than QuickSettingsMenu
		if (!(menu instanceof QuickSettingsMenu)) return menu.box.default_panel;

		const gnome_panel = new Panel("", 2);
		// setting the id after so it's not: `quick-settings-audio-panel@rayzeq.github.io/main@gnome-shell/0`
		gnome_panel.panel_id = `main@gnome-shell/${monitor}`;

		const grid = new PanelGridMenu(menu.sourceActor, menu._arrowAlignment, menu._arrowSide, monitor, gnome_panel, this.settings);
		grid.setArrowOrigin(menu._boxPointer._arrowOrigin);
		grid.setSourceAlignment(menu._boxPointer._sourceAlignment);

		// set properties other extensions might expect
		// @ts-expect-error
		grid._dimEffect = gnome_panel._dimEffect;
		// @ts-expect-error
		grid._grid = gnome_panel._grid;
		// @ts-expect-error
		grid._overlay = gnome_panel._overlay;
		// @ts-expect-error
		grid._setDimmed = gnome_panel._setDimmed.bind(gnome_panel);
		// @ts-expect-error
		grid.getFirstItem = gnome_panel.getFirstItem.bind(gnome_panel);
		// @ts-expect-error
		grid.addItem = gnome_panel.addItem.bind(gnome_panel);
		// @ts-expect-error
		grid.insertItemBefore = gnome_panel.insertItemBefore.bind(gnome_panel);
		// @ts-expect-error
		grid._completeAddItem = gnome_panel._completeAddItem.bind(gnome_panel);

		// the menu is initialized in an async function, we need to wait for it to finish,
		// otherwise we risk patching it midway and breaking everything.
		// note that it is only necessary when dash-to-panel is enabled after QSAP,
		// because we patch the menus it creates instantly after their creation
		// @ts-expect-error: hack
		if (quickSettings.__setup_promise) await quickSettings.__setup_promise;

		const old_menu = this.replace_menu(panel, quickSettings, grid);
		this.move_quick_settings(old_menu, gnome_panel);

		grid.add_panel(gnome_panel);

		const handler_id = this.connect("destroy", () => {
			old_menu.disconnect_object(this);
			panel.disconnect_object(this);

			this.move_quick_settings(gnome_panel, old_menu);
			this.replace_menu(panel, quickSettings, old_menu);
			grid.destroy();

			return false;
		});
		old_menu.connect_object("destroy", () => {
			this.disconnect(handler_id);
		}, this);
		// Dash-to-panel caches menus (even between extension restarts), so they're never
		// destroyed, however the panel are destroyed.
		// It's not really worth unpatching the menu, so we just destroy it.
		panel.connect_object("destroy", async () => {
			this.disconnect(handler_id);
			old_menu.disconnect_object(this);

			try {
				const dash_to_panel_object = Main.extensionManager.lookup("dash-to-panel@jderose9.github.com");
				if (!dash_to_panel_object) return;
				const dash_to_panel = await import(dash_to_panel_object.dir.get_child("extension.js").get_uri());
				// Dash-to-panel is installed but wasn't ever enabled
				if (!dash_to_panel.PERSISTENTSTORAGE) return;

				// Gnome shell is being shut down, don't do anything
				if (gnome_panel.is_destroyed) return;

				const index = dash_to_panel.PERSISTENTSTORAGE["quickSettings"].indexOf(grid);

				this.move_quick_settings(gnome_panel, old_menu);
				this.replace_menu(null, quickSettings, old_menu);
				grid.destroy();

				dash_to_panel.PERSISTENTSTORAGE["quickSettings"][index] = old_menu;
			} catch (e) {
				console.error(e);
			}
		}, this);

		return gnome_panel;
	}

	private replace_menu(panel: GnomePanel | DtpPanel | null, quick_settings: QuickSettings, new_menu: QuickSettingsMenu): PanelGridMenu;
	private replace_menu(panel: GnomePanel | DtpPanel | null, quick_settings: QuickSettings, new_menu: PanelGridMenu): QuickSettingsMenu;
	private replace_menu(panel: GnomePanel | DtpPanel | null, quick_settings: QuickSettings, new_menu: QuickSettingsMenu | PanelGridMenu): QuickSettingsMenu | PanelGridMenu {
		const old_menu = quick_settings.menu as QuickSettingsMenu | PanelGridMenu;

		if (panel) {
			// undo changes done by `Panel._onMenuSet`
			// @ts-expect-error: PanelGridMenu is invalid because we override some of its properties
			panel.menuManager.removeMenu(old_menu);
			// @ts-expect-error: property set by `Panel`
			delete old_menu._openChangedConnected;
			old_menu.disconnect_object(panel);
		}

		// undo changes done by `PanelMenuButton.setMenu`
		old_menu.actor.remove_style_class_name("panel-menu");
		// there should be only one id, but let's be careful
		for (const id of old_menu._signalConnectionsByName?.["open-state-changed"]!) old_menu.disconnect(id);
		// @ts-expect-error: wrong type in GObject
		GObject.signal_handlers_disconnect_matched(old_menu.actor, { signalId: "key-press-event" });
		Main.layoutManager.uiGroup.remove_child(old_menu.actor);

		// undo changes done by `QuickSettingsMenu`
		Main.layoutManager.disconnect_object(old_menu);

		// @ts-expect-error: prevent old_menu from being destroyed, but is technically invalid
		delete quick_settings.menu;
		// @ts-expect-error: PanelGridMenu is invalid because we override some of its properties
		quick_settings.setMenu(new_menu);
		Main.layoutManager.connect_object("system-modal-opened", () => new_menu.close(PopupAnimation.FULL), new_menu);

		return old_menu;
	}

	private move_quick_settings(old_menu: QuickSettingsMenu | Panel, new_menu: QuickSettingsMenu | Panel) {
		for (const item of old_menu.getItems()) {
			const column_span = old_menu.getColumnSpan(item);
			const visible = item.visible;

			old_menu.removeItem(item);

			new_menu.addItem(item, column_span);
			// Adding a widget to another automatically make it visible, so we reset manually
			item.visible = visible;
		}
	}
};
