import GObject from "gi://GObject";

type ObjectConstructor = GObject.ObjectConstructor;
type ParamSpec = GObject.ParamSpec;
type GType = GObject.GType;
type MetaInfo<Props, Interfaces, Sigs> = GObject.MetaInfo<Props, Interfaces, Sigs>;

/** Same as GObject.registerClass, but adds the calling extension's UUID to the class name */
export function registerClass<
	T extends ObjectConstructor,
	Props extends { [key: string]: ParamSpec },
	Interfaces extends { $gtype: GType }[],
	Sigs extends {
		[key: string]: {
			param_types?: readonly GType[];
			[key: string]: any;
		};
	},
>(options: MetaInfo<Props, Interfaces, Sigs>, cls: T): T;
export function registerClass<T extends ObjectConstructor>(cls: T): T;
export function registerClass<
	T extends ObjectConstructor,
	Props extends { [key: string]: ParamSpec },
	Interfaces extends { $gtype: GType }[],
	Sigs extends {
		[key: string]: {
			param_types?: readonly GType[];
			[key: string]: any;
		};
	},
>(optionsOrKlass: any, cls?: T): T {
	let actualOptions: MetaInfo<Props, Interfaces, Sigs>;
	let actualCls: T;

	if (cls === undefined) {
		actualCls = optionsOrKlass;
		actualOptions = {};
	} else {
		actualOptions = optionsOrKlass;
		actualCls = cls;
	}

	const defaultName = `LibPanel_${actualCls.name}`;
	const uuid = current_extension_uuid()?.replace(/[^A-Za-z_-]/g, "-");
	if (uuid === undefined) {
		console.error("Libpanel's registerClass not called from within extension code. Not mangling name");
	} else {
		actualOptions.GTypeName = `${actualOptions.GTypeName || defaultName}_${uuid}`;
	}

	return GObject.registerClass(actualOptions, actualCls);
}

/** Python-like split */
export function split(string: string, sep: string, maxsplit: number): string[] {
	const splitted = string.split(sep);
	return maxsplit ? splitted.slice(0, maxsplit).concat([splitted.slice(maxsplit).join(sep)]) : splitted;
}

/** Python-like rsplit */
export function rsplit(string: string, sep: string, maxsplit: number): string[] {
	const splitted = string.split(sep);
	return maxsplit ? [splitted.slice(0, -maxsplit).join(sep)].concat(splitted.slice(-maxsplit)) : splitted;
}

/** Removes an item from an array and returns whether there was something to remove */
export function array_remove<T>(array: T[], item: T): boolean {
	const index = array.indexOf(item);
	if (index > -1) {
		array.splice(index, 1);
		return true;
	}
	return false;
}

/** Insert one or more items in an array at a specific index */
export function array_insert<T>(array: T[], index: number, ...items: T[]) {
	array.splice(index, 0, ...items);
}

export type StackFrame = {
	func: string,
	file: string,
	line: string,
	column: string,
};

export function get_stack(): StackFrame[] | undefined {
	return new Error().stack?.split("\n").slice(1).map(line => line.trim()).filter(Boolean).map(frame => {
		const [func, remaining] = split(frame, "@", 1);
		const [file, line, column] = rsplit(remaining, ":", 2);
		return { func, file, line, column };
	});
}

export function current_extension_uuid() {
	const stack = get_stack();
	if (stack === undefined) return undefined;

	for (const frame of stack.reverse()) {
		if (frame.file.includes("/gnome-shell/extensions/")) {
			const [left, right] = frame.file.split("@").slice(-2);
			return `${left.split("/").at(-1)}@${right.split("/")[0]}`;
		}
	}
		
	return undefined;
}
