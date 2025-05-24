import type Clutter from "gi://Clutter";
import GObject from "gi://GObject";

import { registerClass } from "./utils.js";

type Constructor<T> = new (...args: any[]) => T;

interface SemitransparentInterface {
    transparent: boolean;
}

export type Semitransparent<T> = Constructor<T & SemitransparentInterface>;
export function Semitransparent<T extends Constructor<Clutter.Actor>>(superclass: T) {
    if (!Semitransparent.cache) Semitransparent.cache = new Map();

    const cached = Semitransparent.cache.get(superclass.name);
    if (cached) return cached as Semitransparent<InstanceType<T>>;

    const klass = registerClass({
        GTypeName: `LibPanel_Semitransparent_${superclass.name}`,
        Properties: {
            "transparent": GObject.ParamSpec.boolean(
                "transparent",
                "Transparent",
                "Whether this widget is transparent to pointer events",
                GObject.ParamFlags.READWRITE,
                true
            ),
        },
    }, class extends superclass implements SemitransparentInterface {
        private _transparent?: boolean;

        public get transparent(): boolean {
            if (this._transparent === undefined) this._transparent = true;
            return this._transparent;
        }

        public set transparent(value: boolean) {
            if (this._transparent === value) return;
            this._transparent = value;
            this.notify("transparent");
        }

        public override vfunc_pick(context: Clutter.PickContext): void {
            if (!this.transparent) super.vfunc_pick(context);
            for (const child of this.get_children()) child.pick(context);
        }
    }) as unknown as Semitransparent<InstanceType<T>>;

    Semitransparent.cache.set(superclass.name, klass);
    return klass;
};

export namespace Semitransparent {
    export let cache: Map<string, Semitransparent<Clutter.Actor>> | undefined;
}
