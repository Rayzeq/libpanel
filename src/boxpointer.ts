import Clutter from "gi://Clutter";
import type Graphene from "gi://Graphene";
import type Mtk from "gi://Mtk";
import St from "gi://St";

import { PopupAnimation } from "resource:///org/gnome/shell/ui/boxpointer.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { Semitransparent } from "./mixins.js";
import { registerClass } from "./utils.js";

const POPUP_ANIMATION_TIME = 150;

export const FullscreenBoxpointer = registerClass(class FullscreenBoxpointer extends Semitransparent(St.Widget) {
	/** Will be left or right if the arrow is at the top or bottom and vice versa */
	public secondary_side: St.Side;
	public center: number;

	// Note: to make this class look like an actual BoxPointer, do not rename those fields
	public bin: St.Bin;

	private _sourceAlignment: number;
	private _sourceActor?: Clutter.Actor | undefined;

	/** @internal */
	public _arrowSide: St.Side;
	public _userArrowSide: St.Side;
	private _arrowOrigin: number;
	private _arrowAlignment: number;

	private _muteKeys: boolean;
	private _muteInput: boolean;

	constructor(arrow_side: St.Side, bin_properties?: Partial<St.Bin.ConstructorProps>) {
		super();

		this.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);

		this._arrowSide = arrow_side;
		this._userArrowSide = arrow_side;
		this._arrowOrigin = 0;
		this._sourceAlignment = 0.5;
		this._arrowAlignment = 0.5;
		this._muteKeys = true;
		this._muteInput = true;

		this.bin = new St.Bin(bin_properties);
		this.add_child(this.bin);

		// We don't really care about the default value, as long as it's coherent with this._arrowSide
		switch (arrow_side) {
			case St.Side.TOP:
			case St.Side.BOTTOM:
				this.secondary_side = St.Side.LEFT;
				break;
			case St.Side.LEFT:
			case St.Side.RIGHT:
				this.secondary_side = St.Side.TOP;
				break;
		};
		this.center = 0;

		this.connect("notify::visible", () => {
			if (this.visible)
				global.compositor.disable_unredirect();
			else
				global.compositor.enable_unredirect();
		});
	}

	private _compute_allocation(box: Clutter.ActorBox) {
		if (!this._sourceActor || !this._sourceActor.mapped) {
			return;
		}

		const monitor_index = Main.layoutManager.findIndexForActor(this._sourceActor);
		const workarea = Main.layoutManager.getWorkAreaForMonitor(monitor_index);

		box.x1 = workarea.x;
		box.x2 = workarea.x + workarea.width;
		box.y1 = workarea.y;
		box.y2 = workarea.y + workarea.height;

		const source_extents = this._sourceActor.get_transformed_extents();
		this._update_arrow_side(source_extents, workarea);

		const theme_node = this.get_theme_node();
		const gap = theme_node.get_length("-boxpointer-gap");
		const padding = theme_node.get_length("-arrow-rise");
		const base_space = gap + padding;

		let space;
		switch (this._arrowSide) {
			case St.Side.TOP:
				space = base_space + source_extents.get_bottom_right().y - workarea.y;
				break;
			case St.Side.BOTTOM:
				space = base_space + workarea.y + workarea.height - source_extents.get_top_left().y;
				break;
			case St.Side.LEFT:
				space = base_space + source_extents.get_bottom_right().x - workarea.x;
				break;
			case St.Side.RIGHT:
				space = base_space + workarea.x + workarea.width - source_extents.get_top_left().x;
				break;
		}
		box.x1 += space;
		box.x2 -= space;
		box.y1 += space;
		box.y2 -= space;
	}

	public override vfunc_get_preferred_width(_for_height: number): [number, number] {
		const box = new Clutter.ActorBox();
		this._compute_allocation(box);

		const width = box.get_width();
		return [width, width];
	}

	public override vfunc_get_preferred_height(_for_width: number): [number, number] {
		const box = new Clutter.ActorBox();
		this._compute_allocation(box);

		const height = box.get_height();
		return [height, height];
	}

	public override vfunc_allocate(box: Clutter.ActorBox) {
		this._compute_allocation(box);
		this.set_allocation(box);
		this.bin.allocate(this.get_theme_node().get_content_box(box));
	}

	// Methods from the original BoxPointer
	public override vfunc_captured_event(event: Clutter.Event) {
		if (event.type() === Clutter.EventType.ENTER ||
			event.type() === Clutter.EventType.LEAVE)
			return Clutter.EVENT_PROPAGATE;

		let mute = event.type() === Clutter.EventType.KEY_PRESS ||
			event.type() === Clutter.EventType.KEY_RELEASE
			? this._muteKeys : this._muteInput;

		if (mute)
			return Clutter.EVENT_STOP;

		return Clutter.EVENT_PROPAGATE;
	}

	public get arrowSide() {
		return this._arrowSide;
	}

	public setArrowOrigin(origin: number) {
		this._arrowOrigin = origin;
	}

	public setSourceAlignment(alignment: number) {
		this._sourceAlignment = Math.clamp(alignment, 0.0, 1.0);

		if (!this._sourceActor)
			return;

		this.setPosition(this._sourceActor, this._arrowAlignment);
	}

	public setPosition(source_actor: Clutter.Actor | undefined, alignment: number) {
		if (!this._sourceActor || source_actor !== this._sourceActor) {
			this._sourceActor?.disconnect_object(this);
			this._sourceActor = source_actor;
			this._sourceActor?.connect_object("destroy", () => (this._sourceActor = undefined), this);
		}

		this._arrowAlignment = Math.clamp(alignment, 0.0, 1.0);

		this.queue_relayout();
	}

	public open(animate: PopupAnimation, on_complete: () => void) {
		let themeNode = this.get_theme_node();
		let rise = themeNode.get_length("-arrow-rise");
		let animationTime = animate & PopupAnimation.FULL ? POPUP_ANIMATION_TIME : 0;

		if (animate & PopupAnimation.FADE)
			this.opacity = 0;
		else
			this.opacity = 255;

		this._muteKeys = false;
		this.show();

		if (animate & PopupAnimation.SLIDE) {
			switch (this._arrowSide) {
				case St.Side.TOP:
					this.translation_y = -rise;
					break;
				case St.Side.BOTTOM:
					this.translation_y = rise;
					break;
				case St.Side.LEFT:
					this.translation_x = -rise;
					break;
				case St.Side.RIGHT:
					this.translation_x = rise;
					break;
			}
		}

		this.ease({
			opacity: 255,
			translation_x: 0,
			translation_y: 0,
			duration: animationTime,
			mode: Clutter.AnimationMode.LINEAR,
			onComplete: () => {
				this._muteInput = false;
				if (on_complete)
					on_complete();
			},
		});
	}

	public close(animate: PopupAnimation, on_complete: () => void) {
		if (!this.visible)
			return;

		let translation_x = 0;
		let translation_y = 0;
		let theme_node = this.get_theme_node();
		let rise = theme_node.get_length("-arrow-rise");
		let fade = animate & PopupAnimation.FADE;
		let animation_time = animate & PopupAnimation.FULL ? POPUP_ANIMATION_TIME : 0;

		if (animate & PopupAnimation.SLIDE) {
			switch (this._arrowSide) {
				case St.Side.TOP:
					translation_y = rise;
					break;
				case St.Side.BOTTOM:
					translation_y = -rise;
					break;
				case St.Side.LEFT:
					translation_x = rise;
					break;
				case St.Side.RIGHT:
					translation_x = -rise;
					break;
			}
		}

		this._muteInput = true;
		this._muteKeys = true;

		this.remove_all_transitions();
		this.ease({
			opacity: fade ? 0 : 255,
			translation_x,
			translation_y,
			duration: animation_time,
			mode: Clutter.AnimationMode.LINEAR,
			onComplete: () => {
				this.hide();
				this.opacity = 0;
				this.translation_x = 0;
				this.translation_y = 0;
				if (on_complete)
					on_complete();
			},
		});
	}

	// Based on _calculateArrowSide
	private _update_arrow_side(source_extents: Graphene.Rect, workarea: Mtk.Rectangle) {
		const source_top_left = source_extents.get_top_left();
		const source_bottom_right = source_extents.get_bottom_right();
		const source_horizontal_center = (source_top_left.x + source_bottom_right.x) / 2;
		const source_vertical_center = (source_top_left.y + source_bottom_right.y) / 2;

		// Note: _calculateArrowSide flips if the preferred size overflows the screen.
		// Since our preferred size is always the whole screen, we flip if flipping would
		// give us more space
		switch (this._userArrowSide) {
			case St.Side.TOP:
			case St.Side.BOTTOM:
				const top_half_height = source_top_left.y - workarea.y;
				const bottom_half_height = workarea.y + workarea.height - source_bottom_right.y;
				if (top_half_height > bottom_half_height)
					this._arrowSide = St.Side.BOTTOM;
				else
					this._arrowSide = St.Side.TOP;

				if (source_horizontal_center < workarea.x + workarea.width / 2)
					this.secondary_side = St.Side.LEFT;
				else
					this.secondary_side = St.Side.RIGHT;

				this.center = source_horizontal_center;
				break;
			case St.Side.LEFT:
			case St.Side.RIGHT:
				const left_half_width = source_top_left.x - workarea.x;
				const right_half_width = workarea.x + workarea.width - source_bottom_right.x;
				if (left_half_width > right_half_width)
					this._arrowSide = St.Side.RIGHT;
				else
					this._arrowSide = St.Side.LEFT;

				if (source_vertical_center < workarea.y + workarea.height / 2)
					this.secondary_side = St.Side.TOP;
				else
					this.secondary_side = St.Side.BOTTOM;

				this.center = source_vertical_center;
				break;
		}
	}
});
export default FullscreenBoxpointer;
export type FullscreenBoxpointer = InstanceType<typeof FullscreenBoxpointer>;