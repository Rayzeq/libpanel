import Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import St from "gi://St";

import { PopupMenu } from "resource:///org/gnome/shell/ui/popupMenu.js";

import FullscreenBoxpointer from "./boxpointer.js";
import PanelGrid from "./grid.js";
import { Panel } from "./panel.js";

// The spacing between panels in the grid, in pixels.
const GRID_SPACING = 5;

export default class PanelGridMenu extends PopupMenu {
	// Should be in `PopupMenu` (and should be of type `BoxPointer`)
	declare private _boxPointer: FullscreenBoxpointer;
	// @ts-expect-error: replacing some gnome types
	public box: PanelGrid;

	constructor(source: St.Widget, arrow_alignment: number, arrow_side: St.Side, default_panel: Clutter.Actor, settings: Gio.Settings) {
		super(source, arrow_alignment, arrow_side);

		const new_boxpointer = new FullscreenBoxpointer(arrow_side);

		// Replace the box
		this.box = new PanelGrid(new_boxpointer, default_panel, settings);
		this.box.style = `spacing-rows: ${GRID_SPACING}px; spacing-columns: ${GRID_SPACING}px`;

		// Delete some things
		global.focus_manager.remove_group(this.actor);
		this._boxPointer.destroy();

		// Code from PopupMenu's constructor
		this._boxPointer = new_boxpointer;
		// @ts-expect-error: for some reason `this.actor` is read-only
		this.actor = this._boxPointer;
		// @ts-expect-error: `_delegate` is never defined anywhere
		this.actor._delegate = this;
		this.actor.style_class = "popup-menu-boxpointer";

		this._boxPointer.bin.set_child(this.box);
		this.actor.add_style_class_name("popup-menu");

		global.focus_manager.add_group(this.actor);
		this.actor.reactive = true;
	}

	get transparent() {
		return this._boxPointer.transparent && this.box.transparent;
	}

	set transparent(value) {
		this._boxPointer.transparent = value;
	}

	get panels(): Panel[] {
		// just assume that we have only valid panels
		return <Panel[]>this.box.get_children();
	}

	close(animate: boolean) {
		for (const panel of this.panels) {
			panel.close?.(animate);
		}
		super.close(animate);
	}

	add_panel(panel: Panel) {
		this.box.add_child(panel);
	}
}
