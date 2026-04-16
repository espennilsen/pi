import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import type { Widget, WidgetContext } from "./index.ts";

export class ClockWidget implements Widget {
	readonly id = "clock";
	readonly label = "Clock";
	readonly icon = "🕐";

	async refresh(): Promise<void> {
		/* no-op — renders current time */
	}

	render(w: number, th: Theme): string[] {
		const now = new Date();
		const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Oslo" });
		const date = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Oslo" });

		const digits: Record<string, string[]> = {
			"0": ["█▀█", "█ █", "▀▀▀"],
			"1": [" ▀█", "  █", "  ▀"],
			"2": ["▀▀█", "█▀▀", "▀▀▀"],
			"3": ["▀▀█", " ▀█", "▀▀▀"],
			"4": ["█ █", "▀▀█", "  ▀"],
			"5": ["█▀▀", "▀▀█", "▀▀▀"],
			"6": ["█▀▀", "█▀█", "▀▀▀"],
			"7": ["▀▀█", "  █", "  ▀"],
			"8": ["█▀█", "█▀█", "▀▀▀"],
			"9": ["█▀█", "▀▀█", "▀▀▀"],
			":": [" ", "·", " "],
		};

		const chars = time.slice(0, 5).split(""); // HH:MM
		const rows = [0, 1, 2].map((row) => {
			const line = chars.map((c) => (digits[c] ?? [" ", " ", " "])[row] ?? " ").join(" ");
			return truncateToWidth(` ${th.fg("accent", line)}`, w);
		});

		return [...rows, truncateToWidth(` ${th.fg("muted", date)}`, w)];
	}
}
