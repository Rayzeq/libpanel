import type GObject from "gi://GObject";
import type St from "gi://St";

import type { EventEmitter } from "resource:///org/gnome/shell/misc/signals.js";
import type { Monitor } from "resource:///org/gnome/shell/ui/layout.js";
import type { QuickSettings } from "resource:///org/gnome/shell/ui/panel.js";
import type { PopupMenuManager } from "resource:///org/gnome/shell/ui/popupMenu.js";

declare class Panel extends St.Widget {
	menuManager: PopupMenuManager;
	monitor: Monitor;
	statusArea: {
		quickSettings: QuickSettings;
	};
}

declare module "@girs/shell-18/shell-18" {
	namespace Shell {
		interface Global extends GObject.Object {
			dashToPanel?: EventEmitter<{ "panels-created": [] }> & {
				panels?: Panel[];
			};
		}
	}
}
