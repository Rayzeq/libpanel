import Clutter from "gi://Clutter";

export interface Panel extends Clutter.Actor {
	close?(animate: boolean): void;
}