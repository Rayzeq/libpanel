import GObject from "gi://GObject";
import { get_extension_uuid } from "./utils_old.js";

type ObjectConstructor = GObject.ObjectConstructor;
type ParamSpec = GObject.ParamSpec;
type GType = GObject.GType;
type MetaInfo<Props, Interfaces, Sigs> = GObject.MetaInfo<Props, Interfaces, Sigs>;

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
	const uuid = get_extension_uuid()?.replace(/[^A-Za-z_-]/g, "-");
	if (uuid === undefined) {
		console.error("Libpanel's registerClass not called from within extension code. Not mangling name");
	} else {
		actualOptions.GTypeName = `${actualOptions.GTypeName || defaultName}_${uuid}`;
	}

	return GObject.registerClass(actualOptions, actualCls);
}
					
						
								
							
								
							
								
							
								
							
						
					
	
		