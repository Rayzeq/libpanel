import Clutter from "gi://Clutter";
import type Graphene from "gi://Graphene";
import type Mtk from "gi://Mtk";
import St from "gi://St";

import { PopupAnimation } from "resource:///org/gnome/shell/ui/boxpointer.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { Semitransparent } from "./mixins.js";
import { registerClass } from "./utils.js";

const POPUP_ANIMATION_TIME = 150;

export const FullscreenBoxpointer = registerClass(class PanelGrid extends Semitransparent(St.Widget) {
	public bin: St.Bin;

	private _sourceAlignment: number;
	private _sourceActor?: Clutter.Actor | null;

	private _arrowSide: St.Side;
	private _userArrowSide: St.Side;
	private _arrowOrigin: number;
	private _arrowAlignment: number;

	private _muteKeys: boolean;
	private _muteInput: boolean;

	constructor(arrowSide: St.Side, binProperties?: Partial<St.Bin.ConstructorProps>) {
		super();

		this.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);

		this._arrowSide = arrowSide;
		this._userArrowSide = arrowSide;
		this._arrowOrigin = 0;
		this._sourceAlignment = 0.5;
		this._arrowAlignment = 0.5;
		this._muteKeys = true;
		this._muteInput = true;

		this.bin = new St.Bin(binProperties);
		this.add_child(this.bin);

		this.connect('notify::visible', () => {
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
		const gap = theme_node.get_length('-boxpointer-gap');
		const padding = theme_node.get_length('-arrow-rise');
		const base_space = gap + padding;

		switch (this._arrowSide) {
			case St.Side.TOP: {
				const space = base_space + source_extents.get_bottom_right().y - workarea.y;
				box.y1 += space;
				break;
			}
			case St.Side.BOTTOM: {
				const space = base_space + workarea.y + workarea.height - source_extents.get_top_left().y;
				box.y2 -= space;
				break;
			}
			case St.Side.LEFT: {
				const space = base_space + source_extents.get_bottom_right().x - workarea.x;
				box.x1 += space;
				break;
			}
			case St.Side.RIGHT: {
				const space = base_space + workarea.x + workarea.width - source_extents.get_top_left().x;
				box.x2 -= space;
				break;
			}
		}
	}

	public override vfunc_get_preferred_width(_forHeight: number): [number, number] {
		const box = new Clutter.ActorBox();
		this._compute_allocation(box);

		const width = box.get_width();
		return [width, width];
	}

	public override vfunc_get_preferred_height(_forWidth: number): [number, number] {
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
	vfunc_captured_event(event: Clutter.Event) {
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

	public setPosition(sourceActor: Clutter.Actor | undefined, alignment: number) {
		if (!this._sourceActor || sourceActor !== this._sourceActor) {
			// @ts-expect-error: `disconnectObject` is added on `GObject.Object` by gnome shell (see environment.js)
			this._sourceActor?.disconnectObject(this);

			this._sourceActor = sourceActor;

			// @ts-expect-error: `connectObject` is added on `GObject.Object` by gnome shell (see environment.js)
			this._sourceActor?.connectObject('destroy', () => (this._sourceActor = null), this);
		}

		this._arrowAlignment = Math.clamp(alignment, 0.0, 1.0);

		this.queue_relayout();
	}

	public open(animate: PopupAnimation, onComplete: () => void) {
		let themeNode = this.get_theme_node();
		let rise = themeNode.get_length('-arrow-rise');
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

		// @ts-expect-error: `ease` is added on `Clutter.Actor` by gnome shell (see environment.js)
		this.ease({
			opacity: 255,
			translation_x: 0,
			translation_y: 0,
			duration: animationTime,
			mode: Clutter.AnimationMode.LINEAR,
			onComplete: () => {
				this._muteInput = false;
				if (onComplete)
					onComplete();
			},
		});
	}

	public close(animate: PopupAnimation, onComplete: () => void) {
		if (!this.visible)
			return;

		let translationX = 0;
		let translationY = 0;
		let themeNode = this.get_theme_node();
		let rise = themeNode.get_length('-arrow-rise');
		let fade = animate & PopupAnimation.FADE;
		let animationTime = animate & PopupAnimation.FULL ? POPUP_ANIMATION_TIME : 0;

		if (animate & PopupAnimation.SLIDE) {
			switch (this._arrowSide) {
				case St.Side.TOP:
					translationY = rise;
					break;
				case St.Side.BOTTOM:
					translationY = -rise;
					break;
				case St.Side.LEFT:
					translationX = rise;
					break;
				case St.Side.RIGHT:
					translationX = -rise;
					break;
			}
		}

		this._muteInput = true;
		this._muteKeys = true;

		this.remove_all_transitions();
		// @ts-expect-error: `ease` is added on `Clutter.Actor` by gnome shell (see environment.js)
		this.ease({
			opacity: fade ? 0 : 255,
			translation_x: translationX,
			translation_y: translationY,
			duration: animationTime,
			mode: Clutter.AnimationMode.LINEAR,
			onComplete: () => {
				this.hide();
				this.opacity = 0;
				this.translation_x = 0;
				this.translation_y = 0;
				if (onComplete)
					onComplete();
			},
		});
	}

	// Based on _calculateArrowSide
	_update_arrow_side(source_extents: Graphene.Rect, workarea: Mtk.Rectangle) {
		const sourceTopLeft = source_extents.get_top_left();
		const sourceBottomRight = source_extents.get_bottom_right();

		// Note: _calculateArrowSide flips if the preferred size overflows the screen.
		// Since our preferred size is always the whole screen, we flip if flipping would
		// give us more space
		switch (this._userArrowSide) {
			case St.Side.TOP:
			case St.Side.BOTTOM:
				const top_half_height = sourceTopLeft.y - workarea.y;
				const bottom_half_height = workarea.y + workarea.height - sourceBottomRight.y;
				if (top_half_height > bottom_half_height)
					this._arrowSide = St.Side.BOTTOM;
				else
					this._arrowSide = St.Side.TOP;
				break;
			case St.Side.LEFT:
			case St.Side.RIGHT:
				const left_half_width = sourceTopLeft.x - workarea.x;
				const right_half_width = workarea.x + workarea.width - sourceBottomRight.x;
				if (left_half_width > right_half_width)
					this._arrowSide = St.Side.RIGHT;
				else
					this._arrowSide = St.Side.LEFT;
				break;
		}
	}
});
export default FullscreenBoxpointer;
export type FullscreenBoxpointer = InstanceType<typeof FullscreenBoxpointer>;