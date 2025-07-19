import Clutter from "gi://Clutter";
import Cogl from "gi://Cogl";
import GObject from "gi://GObject";
import St from "gi://St";

import { PopupAnimation } from "resource:///org/gnome/shell/ui/boxpointer.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import type { QuickMenuToggle, QuickSettingsItem, QuickSettingsLayout, QuickToggleMenu } from "resource:///org/gnome/shell/ui/quickSettings.js";

import { current_extension_uuid, registerClass } from "./utils.js";

const QuickSettingsLayoutConstructor = Main.panel.statusArea.quickSettings.menu._grid.layout_manager.constructor as typeof QuickSettingsLayout;

export interface PanelInterface extends Clutter.Actor {
	panel_id: string,
	close?(animate: PopupAnimation): void;
}

export interface QuickSettingsPanelInterface {
	getItems(): Clutter.Actor[];
	getFirstItem(): Clutter.Actor;
	addItem(item: Clutter.Actor, column_span?: number): void;
	insertItemBefore(item: Clutter.Actor, sibling: Clutter.Actor, column_span?: number): void;
	removeItem(item: Clutter.Actor): void;
	getColumnSpan(item: Clutter.Actor): number;
	setColumnSpan(item: Clutter.Actor, column_span: number): void;
}

// Base panel, reproducing gnome's QuickSettingsMenu
const BasePanel = registerClass(class BasePanel extends St.Widget implements PanelInterface, QuickSettingsPanelInterface {
	public panel_id: string;

	// Do not rename. Those are the same names that the ones used by QuickSettingsMenu
	private _overlay: Clutter.Actor;
	protected _grid: St.Widget;
	private _dimEffect: Clutter.BrightnessContrastEffect;
	private _activeMenu?: QuickToggleMenu | undefined;

	constructor(id: string, n_columns: number = 2, properties?: Partial<St.Widget.ConstructorProps>) {
		super({
			// Enable this so the menu block click events from propagating through
			reactive: true,
			...properties
		});
		this.panel_id = `${current_extension_uuid()}/${id}`;

		// Overlay layer that will contain sub-menus
		this._overlay = new Clutter.Actor({ layout_manager: new Clutter.BinLayout() });

		// Placeholder to make empty space when opening a sub-menu
		const placeholder = new Clutter.Actor({
			// The placeholder have the same height as the overlay, which means
			// it have the same height as the opened sub-menu
			constraints: new Clutter.BindConstraint({
				coordinate: Clutter.BindCoordinate.HEIGHT,
				source: this._overlay,
			}),
		});

		this._grid = new St.Widget({
			style_class: "popup-menu-content quick-settings quick-settings-grid",
			layout_manager: new QuickSettingsLayoutConstructor(placeholder, { nColumns: n_columns }),
		});

		// Force the grid to take up all the available width
		this._grid.add_constraint(new Clutter.BindConstraint({
			coordinate: Clutter.BindCoordinate.WIDTH,
			source: this,
		}));
		this.add_child(this._grid);
		this._grid.add_child(placeholder);

		this._overlay.add_constraint(new Clutter.BindConstraint({
			coordinate: Clutter.BindCoordinate.WIDTH,
			source: this._grid,
		}));

		this.add_child(this._overlay);

		this._dimEffect = new Clutter.BrightnessContrastEffect({ enabled: false });
		this._grid.add_effect_with_name("dim", this._dimEffect);
	}

	public getItems(): Clutter.Actor[] {
		// Every child except the placeholder
		return this._grid.get_children().filter(item => item != (this._grid.layout_manager as QuickSettingsLayout)._overlay);
	}

	public getFirstItem(): Clutter.Actor {
		return this.getItems()[0];
	}

	public addItem(item: Clutter.Actor | QuickSettingsItem, column_span: number = 1) {
		this._grid.add_child(item);
		this._completeAddItem(item, column_span);
	}

	public insertItemBefore(item: Clutter.Actor | QuickSettingsItem, sibling: Clutter.Actor, column_span: number = 1) {
		this._grid.insert_child_below(item, sibling);
		this._completeAddItem(item, column_span);
	}

	private _completeAddItem(item: Clutter.Actor | QuickSettingsItem | QuickMenuToggle, column_span: number) {
		this.setColumnSpan(item, column_span);

		if ("menu" in item && item.menu) {
			this._overlay.add_child(item.menu.actor);

			item.menu.connect_object("open-state-changed", (_: QuickToggleMenu, is_open: boolean) => {
				this._setDimmed(is_open);
				this._activeMenu = is_open ? item.menu : undefined;

				// The sub-popup for the power menu is too high.
				// I don't know if it's the real source of the issue, but I suspect that the constraint that fixes its y position
				// isn't accounting for the padding of the grid, so we add it to the offset manually
				// Later: I added the name check because it breaks on the audio panel
				// so I'm almost certain that this is not a proper fix
				if (is_open && this.getItems().indexOf(item) == 0 && this.panel_id == "gnome@main") {
					const constraint = item.menu.actor.get_constraints()[0] as Clutter.BindConstraint;
					constraint.offset = 
						// the offset is normally bound to the height of the source
						constraint.source.height
						+ this._grid.get_theme_node().get_padding(St.Side.TOP);
					// note: we don't reset this property when the item is removed from this panel because
					// we hope that it will reset itself (because it's bound to the height of the source),
					// which in the case in my tests, but maybe some issue will arise because of this
				}

				return false;
			}, this);
		}
		if ("_menuButton" in item && item._menuButton) {
			// @ts-expect-error: hack
			item._menuButton.__libpanel_y_expand_backup = item._menuButton.y_expand;
			item._menuButton.y_expand = false;
		}
	}

	public removeItem(item: Clutter.Actor | QuickSettingsItem | QuickMenuToggle) {
		if (!this._grid.get_children().includes(item)) console.error(`[LibPanel] ${current_extension_uuid()} tried to remove an item not in the panel`);

		item.get_parent()?.remove_child(item);
		if ("menu" in item && item.menu) {
			item.menu.disconnect_object(this);
			item.menu.actor?.get_parent()?.remove_child(item.menu.actor);
		}
		if ("_menuButton" in item && item._menuButton) {
			// @ts-expect-error: hack
			item._menuButton.y_expand = item._menuButton.__libpanel_y_expand_backup;
			// @ts-expect-error: hack
			delete item._menuButton.__libpanel_y_expand_backup;
		}
	}

	public getColumnSpan(item: Clutter.Actor): number {
		if (!this._grid.get_children().includes(item)) console.error(`[LibPanel] ${current_extension_uuid()} tried to get the column span of an item not in the panel`);

		const value = new GObject.Value();
		this._grid.layout_manager.child_get_property(this._grid, item, "column-span", value);
		const column_span = value.get_int();
		value.unset();
		return column_span;
	}

	public setColumnSpan(item: Clutter.Actor, column_span: number) {
		if (!this._grid.get_children().includes(item)) console.error(`[LibPanel] ${current_extension_uuid()} tried to set the column span of an item not in the panel`);

		this._grid.layout_manager.child_set_property(this._grid, item, "column-span", column_span);
	}

	public close() {
		this._activeMenu?.close(PopupAnimation.NONE);
	}

	private _setDimmed(dim: boolean) {
		// copied from https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/quickSettings.js
		const DIM_BRIGHTNESS = -0.4;
		const POPUP_ANIMATION_TIME = 400;

		const val = 127 * (1 + (dim ? 1 : 0) * DIM_BRIGHTNESS);
		const color = new Cogl.Color({
			red: val,
			green: val,
			blue: val,
			alpha: 255,
		});

		// @ts-expect-error: `ease_property` is added on `Clutter.Actor` by gnome shell (see environment.js)
		this._grid.ease_property("@effects.dim.brightness", color, {
			mode: Clutter.AnimationMode.LINEAR,
			duration: POPUP_ANIMATION_TIME,
			onStopped: () => (this._dimEffect.enabled = dim),
		});
		this._dimEffect.enabled = true;
	}
});
type BasePanel = InstanceType<typeof BasePanel>;

const DraggablePanel = registerClass(class DraggablePanel extends BasePanel {
});
type DraggablePanel = InstanceType<typeof DraggablePanel>;

const AutohidingPanel = registerClass(class AutohidingPanel extends DraggablePanel {
	constructor(id: string, n_columns: number = 2, properties?: Partial<St.Widget.ConstructorProps>) {
		super(id, n_columns, properties);

		this._grid.connect("child-added", (_, child) => {
			const handler_id = child.connect("notify::visible", () => this._update_visibility());
			// @ts-expect-error: hack
			child.__libpanel_handler_id = handler_id;
			this._update_visibility();
		});
		this._grid.connect("child-removed", (_, child) => {
			// The check is needed because the placeholder doesn't have the signal
			// @ts-expect-error: hack
			if (child.__libpanel_handler_id) {
				// @ts-expect-error: hack
				child.disconnect(child.__libpanel_handler_id);
				// @ts-expect-error: hack
				delete child.__libpanel_handler_id;
			}
			this._update_visibility();
		});
	}

	private _update_visibility() {
		for (const child of this.getItems()) {
			if (child.visible) {
				this.show();
				return;
			}
		}

		this.hide();
		// // Force the widget to take no space when hidden (this fixes some bugs but I don't know why)
		// this.queue_relayout();
	}
});
type AutohidingPanel = InstanceType<typeof AutohidingPanel>;
export default AutohidingPanel;