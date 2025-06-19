// Documentation: https://github.com/Rayzeq/libpanel/wiki
// Useful links:
//   - Drag & Drop example: https://gitlab.com/justperfection.channel/how-to-create-a-gnome-shell-extension/-/blob/master/example11%40example11.com/extension.js

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import type Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { InjectionManager } from 'resource:///org/gnome/shell/extensions/extension.js';
import { PopupAnimation } from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { QuickSettingsMenu } from 'resource:///org/gnome/shell/ui/quickSettings.js';

import PanelGridMenu from "./menu.js";
import { Semitransparent } from "./mixins.js";
import {
	current_extension_uuid,
	get_settings,
	registerClass,
	rsplit,
	set_style_value,
	split,
} from "./utils.js";
import {
	add_named_connections,
	find_panel,
} from './utils_old.js';

const MenuManager = Main.panel.menuManager;
const QuickSettings = Main.panel.statusArea.quickSettings;
const QuickSettingsLayout = QuickSettings.menu._grid.layout_manager.constructor;

const VERSION = 1;

const AutoHidable = superclass => {
	// We need to cache the created classes or else we would register the same class name multiple times
	if (AutoHidable.cache === undefined) AutoHidable.cache = {};
	if (AutoHidable.cache[superclass.name] !== undefined) return AutoHidable.cache[superclass.name];

	const klass = registerClass({
		GTypeName: `LibPanel_AutoHidable_${superclass.name}`,
	}, class extends superclass {
		constructor(...args) {
			const container = args.at(-1).container;
			delete args.at(-1).container;
			super(...args);

			// We need to accept `null` as valid value here
			// which is why we don't do `container || this`
			this.container = container === undefined ? this : container;
		}

		get container() {
			return this._lpah_container;
		}

		set container(value) {
			if (this._lpah_container !== undefined) this.disconnect_named(this._lpah_container);
			if (value !== null) {
				this._lpah_container = value;
				this.connect_named(this._lpah_container, 'child-added', (_container, child) => {
					this.connect_named(child, 'notify::visible', this._update_visibility.bind(this));
					this._update_visibility();
				});
				this.connect_named(this._lpah_container, 'child-removed', (_container, child) => {
					this.disconnect_named(child);
					this._update_visibility();
				});
				this._update_visibility();
			}
		}

		_get_ah_children() {
			return this._lpah_container.get_children();
		}

		_update_visibility() {
			for (const child of this._get_ah_children()) {
				if (child.visible) {
					this.show();
					return;
				}
			}

			this.hide();
			// Force the widget to take no space when hidden (this fixes some bugs but I don't know why)
			this.queue_relayout();
		}
	});
	AutoHidable.cache[superclass.name] = klass;
	return klass;
};

const GridItem = superclass => {
	// We need to cache the created classes or else we would register the same class name multiple times
	if (GridItem.cache === undefined) GridItem.cache = {};
	if (GridItem.cache[superclass.name] !== undefined) return GridItem.cache[superclass.name];

	const klass = registerClass({
		GTypeName: `LibPanel_GridItem_${superclass.name}`,
	}, class extends superclass {
		constructor(panel_name, ...args) {
			super(...args);

			this.is_grid_item = true;
			this.panel_name = panel_name;

			this._drag_handle = DND.makeDraggable(this, {});
			this.connect_named(this._drag_handle, 'drag-begin', () => {
				QuickSettings.menu.transparent = false;

				// Prevent the first column from disapearing if it only contains `this`
				const column = this.get_parent()._delegate;
				const alignment = column.get_parent()._delegate._alignment;
				this._source_column = column;
				if (column._inner.get_children().length === 1
					&& ((alignment == "left" && column.get_previous_sibling() === null)
						|| (alignment == "right" && column.get_next_sibling() === null))) {
					column._width_constraint.source = this;
					column._inhibit_constraint_update = true;
				}

				this._dnd_placeholder?.destroy();
				this._dnd_placeholder = new DropZone(this);

				this._drag_monitor = {
					dragMotion: this._on_drag_motion.bind(this),
				};
				DND.addDragMonitor(this._drag_monitor);

				this._drag_orig_index = this.get_parent().get_children().indexOf(this);
				// dirty fix for Catppuccin theme (because it relys on CSS inheriting)
				// this may not work with custom grid items
				this.add_style_class_name?.("popup-menu");
			});
			// This is emited BEFORE drag-end, which means that this._dnd_placeholder is still available
			this.connect_named(this._drag_handle, 'drag-cancelled', () => {
				// This stop the dnd system from doing anything with `this`, we want to manage ourselves what to do.
				this._drag_handle._dragState = 2 /* DND.DragState.CANCELLED (this enum is private) */;

				if (this._dnd_placeholder.get_parent() !== null) {
					this._dnd_placeholder.acceptDrop(this);
				} else { // We manually reset the position of the panel because the dnd system will set it at the end of the column
					this.get_parent().remove_child(this);
					this._drag_handle._dragOrigParent.insert_child_at_index(this, this._drag_orig_index);
				}
			});
			// This is called when the drag ends with a drop and when it's cancelled
			this.connect_named(this._drag_handle, 'drag-end', (_drag_handle, _time, _cancelled) => {
				QuickSettings.menu.transparent = true;

				if (this._drag_monitor !== undefined) {
					DND.removeDragMonitor(this._drag_monitor);
					this._drag_monitor = undefined;
				}

				this._dnd_placeholder?.destroy();
				this._dnd_placeholder = null;

				const column = this._source_column;
				if (!column._is_destroyed && column._width_constraint.source == this) {
					column._width_constraint.source = column.get_next_sibling();
					column._inhibit_constraint_update = false;
				}

				// Something, somewhere is setting a forced width & height for this actor,
				// so we undo that
				this.width = -1;
				this.height = -1;
				this.remove_style_class_name?.("popup-menu");
			});
			this.connect_named(this, 'destroy', () => {
				if (this._drag_monitor !== undefined) {
					DND.removeDragMonitor(this._drag_monitor);
					this._drag_monitor = undefined;
				}
			});
		}

		_on_drag_motion(event) {
			if (event.source !== this) return DND.DragMotionResult.CONTINUE;
			if (event.targetActor === this._dnd_placeholder) return DND.DragMotionResult.COPY_DROP;

			const panel = find_panel(event.targetActor);

			const previous_sibling = panel?.get_previous_sibling();
			const target_pos = panel?.get_transformed_position();
			const self_size = this.get_transformed_size();

			this._dnd_placeholder.get_parent()?.remove_child(this._dnd_placeholder);

			if (event.targetActor.is_panel_column) {
				const column = event.targetActor._delegate._inner;
				if (column.y_align == Clutter.ActorAlign.START) {
					column.add_child(this._dnd_placeholder);
				} else {
					column.insert_child_at_index(this._dnd_placeholder, 0); 
				}
			} else if (panel !== undefined) {
				const column = panel.get_parent();
				if (previous_sibling === this._dnd_placeholder || event.y > (target_pos[1] + self_size[1])) {
					column.insert_child_above(this._dnd_placeholder, panel);
				} else {
					column.insert_child_below(this._dnd_placeholder, panel);
				}
			}

			return DND.DragMotionResult.NO_DROP;
		}
	});
	GridItem.cache[superclass.name] = klass;
	return klass;
};

const DropZone = registerClass(class DropZone extends St.Widget {
	constructor(source) {
		super({ style_class: source._drag_actor?.style_class || source.style_class, opacity: 127 });
		this._delegate = this;

		this._height_constraint = new Clutter.BindConstraint({
			coordinate: Clutter.BindCoordinate.WIDTH,
			source: source,
		});
		this._width_constraint = new Clutter.BindConstraint({
			coordinate: Clutter.BindCoordinate.HEIGHT,
			source: source,
		});
		this.add_constraint(this._height_constraint);
		this.add_constraint(this._width_constraint);
	}

	acceptDrop(source, _actor, _x, _y, _time) {
		if (!source.is_grid_item) return false;

		source.get_parent().remove_child(source);

		const column = this.get_parent();
		column.replace_child(this, source);

		column._delegate.get_parent()._delegate._cleanup();
		LibPanel.get_instance()._save_layout();
		return true;
	}
});

export var Panel = registerClass(class Panel extends GridItem(AutoHidable(St.Widget)) {
	constructor(panel_name, nColumns = 2) {
		super(`${current_extension_uuid()}/${panel_name}`, {
			// I have no idea why, but sometimes, a panel (not all of them) gets allocated too much space (behavior similar to `y-expand`)
			// This prevent it from taking all available space
			y_align: Clutter.ActorAlign.START,
			// Enable this so the menu block any click event from propagating through
			reactive: true,
			// We want to set this later
			container: null,
		});
		this._delegate = this;

		// Overlay layer that will hold sub-popups
		this._overlay = new Clutter.Actor({ layout_manager: new Clutter.BinLayout() });

		// Placeholder to make empty space when opening a sub-popup
		const placeholder = new Clutter.Actor({
			// The placeholder have the same height as the overlay, which means
			// it have the same height as the opened sub-popup
			constraints: new Clutter.BindConstraint({
				coordinate: Clutter.BindCoordinate.HEIGHT,
				source: this._overlay,
			}),
		});

		// The grid holding every element
		this._grid = new St.Widget({
			style_class: 'popup-menu-content quick-settings quick-settings-grid',
			layout_manager: new QuickSettingsLayout(placeholder, { nColumns }),
		});
		// Force the grid to take up all the available width. I'm using a constraint because x_expand don't work
		this._grid.add_constraint(new Clutter.BindConstraint({
			coordinate: Clutter.BindCoordinate.WIDTH,
			source: this,
		}));
		this.add_child(this._grid);
		this.container = this._grid;
		this._drag_actor = this._grid;
		this._grid.add_child(placeholder);

		this._dimEffect = new Clutter.BrightnessContrastEffect({ enabled: false });
		this._grid.add_effect_with_name('dim', this._dimEffect);

		this._overlay.add_constraint(new Clutter.BindConstraint({
			coordinate: Clutter.BindCoordinate.WIDTH,
			source: this._grid,
		}));

		this.add_child(this._overlay);
	}

	getItems() {
		// Every child except the placeholder
		return this._grid.get_children().filter(item => item != this._grid.layout_manager._overlay);
	}

	getFirstItem() {
		return this.getItems[0];
	}

	addItem(item, colSpan: number = 1) {
		this._grid.add_child(item);
		this._completeAddItem(item, colSpan);
	}

	insertItemBefore(item, sibling, colSpan: number = 1) {
		this._grid.insert_child_below(item, sibling);
		this._completeAddItem(item, colSpan);
	}

	_completeAddItem(item, colSpan: number) {
		this.setColumnSpan(item, colSpan);

		if (item.menu) {
			this._overlay.add_child(item.menu.actor);

			this.connect_named(item.menu, 'open-state-changed', (_, isOpen: boolean) => {
				this._setDimmed(isOpen);
				this._activeMenu = isOpen ? item.menu : null;
				// The sub-popup for the power menu is too high.
				// I don't know if it's the real source of the issue, but I suspect that the constraint that fixes its y position
				// isn't accounting for the padding of the grid, so we add it to the offset manually
				// Later: I added the name check because it breaks on the audio panel
				// so I'm almost certain that this is not a proper fix
				if (isOpen && this.getItems().indexOf(item) == 0 && this.panel_name == "gnome@main") {
					const constraint = item.menu.actor.get_constraints()[0];
					constraint.offset = 
						// the offset is normally bound to the height of the source
						constraint.source.height
						+ this._grid.get_theme_node().get_padding(St.Side.TOP);
					// note: we don't reset this property when the item is removed from this panel because
					// we hope that it will reset itself (because it's bound to the height of the source),
					// which in the case in my tests, but maybe some issue will arise because of this
				}
			});
		}
		if (item._menuButton) {
			item._menuButton._libpanel_y_expand_backup = item._menuButton.y_expand;
			item._menuButton.y_expand = false;
		}
	}

	removeItem(item) {
		if (!this._grid.get_children().includes(item)) console.error(`[LibPanel] ${current_extension_uuid()} tried to remove an item not in the panel`);

		item.get_parent().remove_child(item);
		if (item.menu) {
			this.disconnect_named(item.menu);
			item.menu.actor?.get_parent()?.remove_child(item.menu.actor);
		}
		if (item._menuButton) {
			item._menuButton.y_expand = item._menuButton._libpanel_y_expand_backup;
			item._menuButton._libpanel_y_expand_backup = undefined;
		}
	}

	getColumnSpan(item) {
		if (!this._grid.get_children().includes(item)) console.error(`[LibPanel] ${current_extension_uuid()} tried to get the column span of an item not in the panel`);

		const value = new GObject.Value();
		this._grid.layout_manager.child_get_property(this._grid, item, 'column-span', value);
		const column_span = value.get_int();
		value.unset();
		return column_span;
	}

	setColumnSpan(item, colSpan: number) {
		if (!this._grid.get_children().includes(item)) console.error(`[LibPanel] ${current_extension_uuid()} tried to set the column span of an item not in the panel`);

		this._grid.layout_manager.child_set_property(this._grid, item, 'column-span', colSpan);
	}

	close() {
		this._activeMenu?.close(PopupAnimation.NONE);
	}

	_get_ah_children() {
		return this.getItems();
	}

	_setDimmed(dim: boolean) {
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

		this._grid.ease_property('@effects.dim.brightness', color, {
			mode: Clutter.AnimationMode.LINEAR,
			duration: POPUP_ANIMATION_TIME,
			onStopped: () => (this._dimEffect.enabled = dim),
		});
		this._dimEffect.enabled = true;
	}
});

// Patching the default to menu to have the exact same api as the one from `Panel`.
// This way, extensions can use them the same way.
QuickSettingsMenu.prototype.getItems = function () {
	return this._grid.get_children().filter(item => item != this._grid.layout_manager._overlay);
};
QuickSettingsMenu.prototype.removeItem = function (item) {
	this._grid.remove_child(item);
	if (item.menu) {
		// it seems that some menus don't have _signalConnectionsByName (probably custom menus)
		// we check it exists before using it
		if (item.menu._signalConnectionsByName) {
			// Manually remove the connection since we don't have its id.
			for (const id of item.menu._signalConnectionsByName["open-state-changed"]) {
				if (item.menu._signalConnections[id].callback.toString().includes("this._setDimmed")) {
					item.menu.disconnect(id);
				}
			}
		}

		this._overlay.remove_child(item.menu.actor);
	}
};
QuickSettingsMenu.prototype.getColumnSpan = function (item) {
	const value = new GObject.Value();
	this._grid.layout_manager.child_get_property(this._grid, item, 'column-span', value);
	const column_span = value.get_int();
	value.unset();
	return column_span;
};
QuickSettingsMenu.prototype.setColumnSpan = function (item, colSpan: number) {
	this._grid.layout_manager.child_set_property(this._grid, item, 'column-span', colSpan);
};

export class LibPanel {
	static _AutoHidable = AutoHidable;
	static _Semitransparent = Semitransparent;
	static _GridItem = GridItem;

	static _DropZone = DropZone;
	static _PanelGrid = PanelGridMenu;

	static get_instance() {
		return Main.panel._libpanel;
	}

	static get VERSION() {
		return LibPanel.get_instance()?.VERSION || VERSION;
	}

	// make the main panel available whether it's the gnome one or the libpanel one
	static get main_panel() {
		return LibPanel.get_instance()?._main_panel || QuickSettings.menu;
	}

	static get enabled() {
		return LibPanel.enablers.length !== 0;
	}

	static get enablers() {
		return LibPanel.get_instance()?._enablers || [];
	}

	static enable() {
		let instance = LibPanel.get_instance();
		if (!instance) {
			instance = Main.panel._libpanel = new LibPanel();
			instance._late_init();
		};
		if (instance.constructor.VERSION != VERSION)
			console.warn(`[LibPanel] ${current_extension_uuid()} depends on libpanel ${VERSION} but libpanel ${instance.constructor.VERSION} is loaded`);

		const uuid = current_extension_uuid();
		if (instance._enablers.indexOf(uuid) < 0) instance._enablers.push(uuid);
	}

	static disable() {
		const instance = LibPanel.get_instance();
		if (!instance) return;

		const index = instance._enablers.indexOf(current_extension_uuid());
		if (index > -1) instance._enablers.splice(index, 1);

		if (instance._enablers.length === 0) {
			instance._destroy();
			Main.panel._libpanel = undefined;
		};
	}

	static addPanel(panel) {
		const instance = LibPanel.get_instance();
		if (!instance)
			console.error(`[LibPanel] ${current_extension_uuid()} tried to add a panel, but the library is disabled.`);

		if (instance._settings.get_boolean('padding-enabled'))
			set_style_value(panel._grid, 'padding', `${instance._settings.get_int('padding')}px`);
		if (instance._settings.get_boolean('row-spacing-enabled'))
			set_style_value(panel._grid, 'spacing-rows', `${instance._settings.get_int('row-spacing')}px`);
		if (instance._settings.get_boolean('column-spacing-enabled'))
			set_style_value(panel._grid, 'spacing-columns', `${instance._settings.get_int('column-spacing')}px`);
		instance._panel_grid._add_panel(panel);
		instance._save_layout();
	}

	static removePanel(panel) {
		panel._keep_layout = true;
		panel.get_parent()?.remove_child(panel);
		panel._keep_layout = undefined;
	}

	_enablers: string[];
	_settings: Gio.Settings;
	_injection_manager: InjectionManager;

	constructor() {
		this._enablers = [];

		const this_path = '/' + split(rsplit(import.meta.url, '/', 1)[0], '/', 3)[3];
		this._settings = get_settings(`${this_path}/org.gnome.shell.extensions.libpanel.gschema.xml`);

		this._injection_manager = new InjectionManager();
		add_named_connections(this._injection_manager, GObject.Object);
	}

	_late_init() {
		// =================== Replacing the popup ==================
		this._settings.connect('changed::alignment', () => {
			this._panel_grid._set_alignment(this._settings.get_string('alignment'));
		});
		this._settings.connect('changed::single-column', () => {
			this._panel_grid._set_is_single_column(this._settings.get_boolean('single-column'));
		});

		const new_menu = new Panel('', 2);
		this._panel_grid = new PanelGridMenu(QuickSettings.menu.sourceActor, QuickSettings.menu._arrowAlignment, QuickSettings.menu._arrowSide, new_menu);
		this._panel_grid.setArrowOrigin(QuickSettings.menu._boxPointer._arrowOrigin);
		this._panel_grid.setSourceAlignment(QuickSettings.menu._boxPointer._sourceAlignment);

		this._old_menu = this._replace_menu(this._panel_grid);

		// we do that to prevent the name being this: `quick-settings-audio-panel@rayzeq.github.io/gnome@main`
		new_menu.panel_name = 'gnome@main';
		this._move_quick_settings(this._old_menu, new_menu);
		LibPanel.addPanel(new_menu);
		this._main_panel = new_menu;

		// =================== Compatibility code ===================
		//this._panel_grid.box = new_menu.box; // this would override existing properties
		//this._panel_grid.actor =  = new_menu.actor;
		this._panel_grid._dimEffect = new_menu._dimEffect;
		this._panel_grid._grid = new_menu._grid;
		this._panel_grid._overlay = new_menu._overlay;
		this._panel_grid._setDimmed = new_menu._setDimmed.bind(new_menu);
		this._panel_grid.getFirstItem = new_menu.getFirstItem.bind(new_menu);
		this._panel_grid.addItem = new_menu.addItem.bind(new_menu);
		this._panel_grid.insertItemBefore = new_menu.insertItemBefore.bind(new_menu);
		this._panel_grid._completeAddItem = new_menu._completeAddItem.bind(new_menu);

		// ================== Visual customization ==================
		const set_style_for_panels = (name, value) => {
			for (const panel of this._panel_grid._get_panels()) {
				set_style_value(panel._grid, name, value);
			}
		};

		this._settings.connect('changed::padding-enabled', () => {
			if (this._settings.get_boolean('padding-enabled'))
				set_style_for_panels('padding', `${this._settings.get_int('padding')}px`);
			else
				set_style_for_panels('padding', null);
		});
		this._settings.connect('changed::padding', () => {
			if (!this._settings.get_boolean('padding-enabled')) return;
			set_style_for_panels('padding', `${this._settings.get_int('padding')}px`);
		});

		this._settings.connect('changed::row-spacing-enabled', () => {
			if (this._settings.get_boolean('row-spacing-enabled'))
				set_style_for_panels('spacing-rows', `${this._settings.get_int('row-spacing')}px`);
			else
				set_style_for_panels('spacing-rows', null);
		});
		this._settings.connect('changed::row-spacing', () => {
			if (!this._settings.get_boolean('row-spacing-enabled')) return;
			set_style_for_panels('spacing-rows', `${this._settings.get_int('row-spacing')}px`);
		});

		this._settings.connect('changed::column-spacing-enabled', () => {
			if (this._settings.get_boolean('column-spacing-enabled'))
				set_style_for_panels('spacing-columns', `${this._settings.get_int('column-spacing')}px`);
			else
				set_style_for_panels('spacing-columns', null);
		});
		this._settings.connect('changed::column-spacing', () => {
			if (!this._settings.get_boolean('column-spacing-enabled')) return;
			set_style_for_panels('spacing-columns', `${this._settings.get_int('column-spacing')}px`);
		});
		// https://gjs-docs.gnome.org/gio20~2.0/gio.settings#signal-changed
		// "Note that @settings only emits this signal if you have read key at
		// least once while a signal handler was already connected for key."
		this._settings.get_boolean('padding-enabled');
		this._settings.get_boolean('row-spacing-enabled');
		this._settings.get_boolean('column-spacing-enabled');
		this._settings.get_int('padding');
		this._settings.get_int('row-spacing');
		this._settings.get_int('column-spacing');
	}

	_destroy() {
		this._move_quick_settings(this._main_panel, this._old_menu);
		this._replace_menu(this._old_menu);
		this._old_menu = null;

		this._panel_grid.destroy();
		this._panel_grid = null;

		this._settings = null;

		this._injection_manager.clear();
	}

	_replace_menu(new_menu) {
		const old_menu = QuickSettings.menu;

		MenuManager.removeMenu(old_menu);
		Main.layoutManager.disconnectObject(old_menu);

		QuickSettings.menu = null; // prevent old_menu from being destroyed
		QuickSettings.setMenu(new_menu);
		old_menu.actor.get_parent().remove_child(old_menu.actor);

		MenuManager.addMenu(new_menu);
		Main.layoutManager.connectObject('system-modal-opened', () => new_menu.close(), new_menu);

		return old_menu;
	}

	_move_quick_settings(old_menu, new_menu) {
		for (const item of old_menu.getItems()) {
			const column_span = old_menu.getColumnSpan(item);
			const visible = item.visible;

			old_menu.removeItem(item);

			new_menu.addItem(item, column_span);
			item.visible = visible; // force reset of visibility
		}
	}

	_save_layout() {
		const layout = this._panel_grid._get_panel_layout();

		// Remove leading empty columns
		while (layout[0]?.length === 0) layout.shift();
		this._settings.set_value(
			"layout",
			GLib.Variant.new_array(
				GLib.VariantType.new('as'),
				layout.map(column => GLib.Variant.new_strv(column))
			)
		);
	}
};
