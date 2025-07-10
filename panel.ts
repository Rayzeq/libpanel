import type Clutter from "gi://Clutter";

export interface Panel extends Clutter.Actor {
	panel_id: string,
	close?(animate: boolean): void;
}