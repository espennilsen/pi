/**
 * Cron jobs for RSS polling and maintenance.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { LogFn } from "./logger.ts";

export function setupCronJobs(pi: ExtensionAPI, log: LogFn): void {
	// Wait for kysely to be ready before setting up cron
	pi.events.on("kysely:ready", () => {
		// Poll RSS feeds every 15 minutes (managed via RSS source poll_interval_minutes)
		pi.events.emit("cron:job:register", {
			name: "untappd:poll-rss",
			schedule: "*/15 * * * *", // Every 15 minutes
			description: "Poll enabled Untappd RSS feeds for check-ins",
			handler: async () => {
				log("cron_poll_rss_start", {});
				
				try {
					// Import dynamically to avoid circular dependencies
					const { pollRSSSources } = await import("./rss/poller.ts");
					await pollRSSSources(log);
					
					log("cron_poll_rss_complete", {});
				} catch (err: any) {
					log("cron_poll_rss_error", { error: err.message }, "error");
					throw err;
				}
			},
		});

		// Decay menu item confidence daily
		pi.events.emit("cron:job:register", {
			name: "untappd:decay-confidence",
			schedule: "0 2 * * *", // Daily at 2 AM
			description: "Decay confidence for menu items based on time since last seen",
			handler: async () => {
				log("cron_decay_confidence_start", {});
				
				try {
					const { decayConfidences } = await import("./maintenance/decay.ts");
					await decayConfidences(log);
					
					log("cron_decay_confidence_complete", {});
				} catch (err: any) {
					log("cron_decay_confidence_error", { error: err.message }, "error");
					throw err;
				}
			},
		});

		log("cron_jobs_registered", { jobs: ["untappd:poll-rss", "untappd:decay-confidence"] });
	});
}
