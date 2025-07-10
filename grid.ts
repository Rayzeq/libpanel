import Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";

import FullscreenBoxpointer from "./boxpointer.js";
import { Semitransparent } from "./mixins.js";
import { PanelInterface } from "./panel.js";
import { registerClass } from "./utils.js";

const GRID_SPACING = 5;

const PanelGridLayoutMeta = registerClass({
	Properties: {
		"column": GObject.ParamSpec.int(
			"column", null, null,
			GObject.ParamFlags.READWRITE,
			GLib.MININT32, GLib.MAXINT32, 0),
		"row": GObject.ParamSpec.int(
			"row", null, null,
			GObject.ParamFlags.READWRITE,
			GLib.MININT32, GLib.MAXINT32, 0),
	},
}, class PanelGridLayoutMeta extends Clutter.LayoutMeta {
	declare public column: number;
	declare public row: number;
});
type PanelGridLayoutMeta = InstanceType<typeof PanelGridLayoutMeta>;

const PanelGridLayout = registerClass({
	Properties: {
		"row-spacing": GObject.ParamSpec.int(
			"row-spacing", null, null,
			GObject.ParamFlags.READWRITE,
			0, GLib.MAXINT32, GRID_SPACING),
		"column-spacing": GObject.ParamSpec.int(
			"column-spacing", null, null,
			GObject.ParamFlags.READWRITE,
			0, GLib.MAXINT32, GRID_SPACING),
	},
}, class PanelGridLayout extends Clutter.LayoutManager {
	private _container?: Clutter.Actor;
	declare public row_spacing: number;
	declare public column_spacing: number;

	private _get_child_properties(container: Clutter.Actor, child: Clutter.Actor): PanelGridLayoutMeta {
		// We assume that the meta layout manager is the right type
		return this.get_child_meta(container, child) as PanelGridLayoutMeta;
	}

	private _container_style_changed(): void {
		// We assume that there is a container (should be always true if this function is always called from the signal)
		// and that it's a subclass of St.Widget and not Clutter.Actor
		const node = (this._container as St.Widget).get_theme_node();

		let changed = false;
		let found, length;
		[found, length] = node.lookup_length("spacing-rows", false);
		changed ||= found;
		if (found)
			this.row_spacing = length;

		[found, length] = node.lookup_length("spacing-columns", false);
		changed ||= found;
		if (found)
			this.column_spacing = length;

		if (changed)
			this.layout_changed();
	}

	public vfunc_get_child_meta_type(): GObject.GType<Clutter.LayoutMeta> {
		return PanelGridLayoutMeta.$gtype;
	}

	public vfunc_set_container(container: Clutter.Actor): void {
		// @ts-expect-error: `disconnectObject` is added on `GObject.Object` by gnome shell (see environment.js)
		this._container?.disconnectObject(this);

		this._container = container;

		// @ts-expect-error: `connectObject` is added on `GObject.Object` by gnome shell (see environment.js)
		this._container?.connectObject("style-changed", () => this._container_style_changed(), this);
	}

	public vfunc_get_preferred_width(_container: Clutter.Actor, _forHeight: number): [number, number] {
		return [-1, -1];
	}

	public vfunc_get_preferred_height(_container: Clutter.Actor, _forWidth: number): [number, number] {
		return [-1, -1];
	}

	public vfunc_allocate(container_: Clutter.Actor, box: Clutter.ActorBox): void {
		// We assume that the container is always a PanelGrid
		const container = container_ as PanelGrid;
		const arrow_side = container.boxpointer._arrowSide;
		
		const is_vertical = arrow_side === St.Side.TOP || arrow_side === St.Side.BOTTOM;
		const groups: Map<number, { pref: number, min: number, widgets: Clutter.Actor[] }> = new Map();
		groups.set(0, { pref: 1, min: 1, widgets: [] });

		for (const child of container.get_children()) {
			if (!child.visible) continue;
			const { column: index } = this._get_child_properties(container, child);

			if (!groups.has(index))
				groups.set(index, { pref: 1, min: 1, widgets: [] });

			const [min_width, min_height, pref_width, pref_height] = child.get_preferred_size();

			const group = groups.get(index)!;
			group.min = Math.max(group.min, is_vertical ? min_width : min_height);
			group.pref = Math.max(group.pref, is_vertical ? pref_width : pref_height);
			group.widgets.push(child);
		}

		// Handle secondary side flipping
		const secondary_side = container.boxpointer.secondary_side;
		if (secondary_side === St.Side.RIGHT || secondary_side === St.Side.BOTTOM) {
			const copy = new Map(groups);
			groups.clear();
			copy.forEach((props, group_index) => {
				groups.set(group_index * -1, props);
			});
		}

		// Fill missing (empty) groups
		const min_group = Math.min(...groups.keys());
		const max_group = Math.max(...groups.keys());
		for (let group_index = min_group; group_index <= max_group; group_index++) {
			if (!groups.has(group_index))
				groups.set(group_index, { pref: 1, min: 1, widgets: [] });
		}

		// Calculate middle group position
		const middle_group = groups.get(0)!;
		let parent = container.get_parent()!;
		let success, center_x, center_y;
		do {
			// `container.boxpointer.center` may be on the x or y axis. We compute both and choose the right one after
			[success, center_x, center_y] = parent.transform_stage_point(container.boxpointer.center, container.boxpointer.center);
			parent = parent.get_parent()!;
		} while (!success);

		const main_min = is_vertical ? box.x1 : box.y1;
		const main_max = is_vertical ? box.x2 : box.y2;
		const middle_group_half = middle_group.pref / 2;
		const center_main = Math.min(Math.max(is_vertical ? center_x : center_y, main_min + middle_group_half), main_max - middle_group_half);
    
		const [_min_width, _min_height, pref_width, pref_height] = container.default_panel.get_preferred_size();
		const max_empty_size = is_vertical ? pref_width : pref_height;

		// Fit left/top groups
		const left_max = center_main - middle_group_half;
		const left_space = left_max - main_min;
		let remaining_space_left = this._fit_groups(
			Array.from(groups)
				.filter(([index, _]) => index < 0)
				.map(([_, group]) => group),
			left_space,
			max_empty_size
		);
		if (remaining_space_left > 0) {
			let new_min_group = min_group - 1;
			remaining_space_left -= this.column_spacing;
			while (remaining_space_left > 0) {
				const size = Math.min(max_empty_size, remaining_space_left);
				groups.set(new_min_group, { pref: size, min: 1, widgets: [] });
				remaining_space_left -= size + this.column_spacing;
				new_min_group -= 1;
			}
		}

		// Fit right/bottom groups
		const right_min = center_main + middle_group_half;
		const right_space = main_max - right_min;
		let remaining_space_right = this._fit_groups(
			Array.from(groups)
				.filter(([index, _]) => index > 0)
				.map(([_, group]) => group),
			right_space,
			max_empty_size
		);
		if (remaining_space_right > 0) {
			let new_max_group = max_group + 1;
			remaining_space_right -= this.column_spacing;
			while (remaining_space_right > 0) {
				const size = Math.min(max_empty_size, remaining_space_right);
				groups.set(new_max_group, { pref: size, min: 1, widgets: [] });
				remaining_space_right -= size + this.column_spacing;
				new_max_group += 1;
			}
		}

		// Allocate groups
		this._allocate_group(middle_group, center_main - middle_group_half, box, container, arrow_side);

		const left_groups = Array.from(groups)
			.filter(([index, _]) => index < 0)
			.sort((a, b) => b[0] - a[0]);
		let main_pos = left_max - this.column_spacing;
		for (const [_, group] of left_groups) {
			main_pos -= group.pref;
			this._allocate_group(group, main_pos, box, container, arrow_side);
			main_pos -= this.column_spacing;
		}

		const right_groups = Array.from(groups)
			.filter(([index, _]) => index > 0)
			.sort((a, b) => a[0] - b[0]);
		main_pos = right_min + this.column_spacing;
		for (const [_, group] of right_groups) {
			this._allocate_group(group, main_pos, box, container, arrow_side);
			main_pos += group.pref + this.column_spacing;
		}
	}

	/**
	 * Resize a list of rows or columns (groups) to fit in `space`.
	 * The final size will be written in 
	 * 
	 * @param spacing - The space between each group.
	 * @param max_empty_size - The maximum size of empty groups.
	 * @returns The remaining space and size of empty groups, if any.
	 */
	private _fit_groups(
		groups: { min: number, pref: number, widgets: Clutter.Actor[] }[],
		space: number,
		max_empty_size: number,
	): number {
		const min_space = groups.reduce((sum, g) => sum + g.min + this.column_spacing, 0);
		const pref_space = groups.reduce((sum, g) => sum + g.pref + this.column_spacing, 0);

		if (min_space > space) {
			const group_size = Math.max((space - this.column_spacing * groups.length) / groups.length, 1);
			groups.forEach(g => g.pref = group_size);
		} else if (pref_space > space) {
			let to_remove = pref_space - space;
			let shrinkable_count = groups.length;
			while (to_remove > 0 && shrinkable_count > 0) {
				const per_group = to_remove / shrinkable_count;
				for (const group of groups) {
					if (group.pref <= group.min) continue;
					const reduction = Math.min(per_group, group.pref - group.min);
					group.pref -= reduction;
					to_remove -= reduction;
					if (group.pref === group.min) shrinkable_count--;
				}
			}
		} else if (pref_space < space) {
			let remaining_space = space - pref_space;
			const empty_groups = groups.filter(g => g.widgets.length === 0);        
			const empty_size = Math.min(remaining_space / empty_groups.length, max_empty_size);
			remaining_space -= empty_size * empty_groups.length;

			empty_groups.forEach(g => g.pref = empty_size);
			return remaining_space;
		}

		return 0;
	}

	private _allocate_group(
		group: { min: number, pref: number, widgets: Clutter.Actor[] },
		main_pos: number,
		box: Clutter.ActorBox,
		container: PanelGrid,
		arrow_side: St.Side
	): void {
		const is_vertical = arrow_side === St.Side.TOP || arrow_side === St.Side.BOTTOM;

		let cross_pos;
		switch (arrow_side) {
			case St.Side.TOP:
				cross_pos = box.y1;
				break;
			case St.Side.BOTTOM:
				cross_pos = box.y2;
				break;
			case St.Side.LEFT:
				cross_pos = box.x1;
				break;
			case St.Side.RIGHT:
				cross_pos = box.x2;
				break;
		}

		group.widgets.sort((a, b) => this._get_child_properties(container, a).row - this._get_child_properties(container, b).row);
		for (const child of group.widgets) {
			const [_min_width, _min_height, pref_width, pref_height] = child.get_preferred_size();
			const child_cross_size = is_vertical ? pref_height : pref_width;
			const child_box = new Clutter.ActorBox();

			switch (arrow_side) {
				case St.Side.TOP:
					child_box.set_size(group.pref, child_cross_size);
					child_box.set_origin(main_pos, cross_pos);
					break;
				case St.Side.BOTTOM:
					child_box.set_size(group.pref, child_cross_size);
					child_box.set_origin(main_pos, cross_pos - child_cross_size);
					break;
				case St.Side.LEFT:
					child_box.set_size(child_cross_size, group.pref);
					child_box.set_origin(cross_pos, main_pos);
					break;
				case St.Side.RIGHT:
					child_box.set_size(child_cross_size, group.pref);
					child_box.set_origin(cross_pos - child_cross_size, main_pos);
					break;
			}

			child.allocate(child_box);

			if (arrow_side === St.Side.TOP || arrow_side === St.Side.LEFT)
				cross_pos += child_cross_size + this.row_spacing;
			else
				cross_pos -= child_cross_size + this.row_spacing;
		}
	}
});
type PanelGridLayout = InstanceType<typeof PanelGridLayout>;

const PanelGrid = registerClass(class PanelGrid extends Semitransparent(St.Widget) {
	public boxpointer: FullscreenBoxpointer;
	public default_panel: Clutter.Actor;

	private settings: Gio.Settings;

	constructor(boxpointer: FullscreenBoxpointer, default_panel: Clutter.Actor, settings: Gio.Settings) {
		super({ layout_manager: new PanelGridLayout(), x_expand: true, y_expand: true });

		this.boxpointer = boxpointer;
		this.default_panel = default_panel;
		this.settings = settings;

		this.connect("child-added", (_, child: PanelInterface) => {
			const layout: Map<string, [number, number]> = new Map(Object.entries(this.settings.get_value("layout").recursiveUnpack()));

			const position = layout.get(child.panel_id);
			if (position) {
				this.set_column(child, position[0]);
				this.set_row(child, position[1]);
			} else {
				// Default position is the bottom of the center column
				let max_row = Math.max(...[...layout.values()].map(v => v[1]));
				if (max_row === -Infinity)
					max_row = -1;
				this.set_column(child, 0);
				this.set_row(child, max_row + 1);

				layout.set(child.panel_id, [0, max_row + 1]);
				this.settings.set_value("layout", new GLib.Variant("a{s(ii)}", Object.fromEntries(layout.entries())));
			}
		});
	}

	private set_column(actor: Clutter.Actor, column: number) {
		this.layout_manager.child_set_property(this, actor, "column", column);
	}

	private set_row(actor: Clutter.Actor, row: number) {
		this.layout_manager.child_set_property(this, actor, "row", row);
	}
});
type PanelGrid = InstanceType<typeof PanelGrid>;
export default PanelGrid;