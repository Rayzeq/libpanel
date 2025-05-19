import GObject from 'gi://GObject';

import type { InjectionManager } from 'resource:///org/gnome/shell/extensions/extension.js';

export type Constructor<T> = new (...args: any[]) => T;

export function add_named_connections<T extends Constructor<U>, U>(injector: InjectionManager, object: T) {
	// this is used to debug things
	/*function _get_address(object) {
		return object.toString().slice(1, 15);
	}*/

	function set_signal(object, source, signal, callback, id) {
		// Add the source map
		if (object._lp_connections === undefined) {
			object._lp_connections = new Map();
			if (object instanceof GObject.Object) {
				object.connect('destroy', () => {
					/*console.log(`${object}: removing connections`,
						JSON.stringify(object._lp_connections, function simplify(key, value) {
							if (value instanceof Map)
								return Object.fromEntries(Array.from(value, ([k, v]) => [simplify(null, k), v]));
							else if (value instanceof GObject.Object)
								return _get_address(value);
							else if (value instanceof Function)
								return "<function>";
							else
								return value;
						})
					);*/
					object.disconnect_named();
				});
			}
		}
		const source_map = object._lp_connections;

		// Add the signal map
		if (!source_map.has(source)) {
			source_map.set(source, new Map());
			source.connect('destroy', () => {
				//console.log(`REMOVING ${_get_address(source)} FROM ${_get_address(object)}`);
				source_map.delete(source);
			});
		}
		const signal_map = source_map.get(source);

		// Add the callback map
		if (!signal_map.has(signal)) signal_map.set(signal, new Map());
		const callback_map = signal_map.get(signal);

		//console.log(`CONNECT ${_get_address(source)}::${signal} -> ${_get_address(object)}::${id}`);
		//console.log(`Fake connections are ${Object.fromEntries(Object.entries(source?._signalConnections))}`);

		// Add the id
		callback_map.set(callback, id);
		return id + 100000; // this is just here to prevent any accidental usage of this id with normal disconnect
	}

	injector.overrideMethod(object.prototype, "connect_named", _wrapped => function (source, signal, callback) {
		return set_signal(this, source, signal, callback, source.connect(signal, callback));
	});
	injector.overrideMethod(object.prototype, "connect_after_named", _wrapped => function (source, signal, callback) {
		return set_signal(this, source, signal, callback, source.connect_after(signal, callback));
	});
	injector.overrideMethod(object.prototype, "disconnect_named", _wrapped => function (source = undefined, signal = undefined, callback = undefined) {
		if (typeof source === 'number') {
			// The function was called with an id.
			const id_to_remove = source - 100000;

			const source_map = this._lp_connections;
			if (!source_map) return;
			for (const [source, signal_map] of source_map.entries()) {
				for (const [signal, callback_map] of signal_map.entries()) {
					for (const [callback, id] of callback_map.entries()) {
						if (id === id_to_remove) {
							this.disconnect_named(source, signal, callback);
						}
					}
				}
			}

			return;
		}

		if (callback !== undefined) {
			// Every argments have been provided
			const source_map = this._lp_connections;
			if (!source_map) return;
			const signal_map = source_map.get(source);
			if (!signal_map) return;
			const callback_map = signal_map.get(signal);
			if (!callback_map) return;
			const id = callback_map.get(callback);
			if (id === undefined) return;

			// console.log(`Disconnecting ${signal} on ${source} with id ${id}`);
			// console.log(`Fake connections are ${Object.fromEntries(Object.entries(source?._signalConnections))}`);
			if (source.signalHandlerIsConnected?.(id) || (source instanceof GObject.Object && GObject.signal_handler_is_connected(source, id)))
				source.disconnect(id);
			callback_map.delete(callback);
		} else if (signal !== undefined) {
			// Only source and signal have been provided
			// console.log(`Disconnecting ${signal} on ${source}`);
			const source_map = this._lp_connections;
			if (!source_map) return;
			const signal_map = source_map.get(source);
			if (!signal_map) return;
			const callback_map = signal_map.get(signal);
			if (!callback_map) return;

			for (const callback of callback_map.keys()) {
				this.disconnect_named(source, signal, callback);
			}
			signal_map.delete(signal);
		} else if (source !== undefined) {
			// Only source have been provided
			// console.log(`Disconnecting ${source}`);
			const source_map = this._lp_connections;
			if (!source_map) return;
			const signal_map = source_map.get(source);
			if (!signal_map) return;

			for (const signal of signal_map.keys()) {
				this.disconnect_named(source, signal);
			}
			source_map.delete(source);
		} else {
			// Nothing have been provided
			// console.log("Disconnecting everything");
			const source_map = this._lp_connections;
			if (!source_map) return;

			for (const source of source_map.keys()) {
				this.disconnect_named(source);
			}
			this._lp_connections.clear();
		}
	});
}

export function find_panel(widget) {
	const panels = [];

	do {
		if (widget.is_grid_item) {
			panels.push(widget);
		}
	} while ((widget = widget.get_parent()) !== null);

	return panels.at(-1);
}
