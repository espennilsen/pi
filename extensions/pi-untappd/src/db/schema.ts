/**
 * pi-untappd database schema definition.
 * 
 * No direct kysely imports - all interaction via event bus.
 */

export const SCHEMA = {
	actor: "pi-untappd",
	tables: {
		untappd_venues: {
			columns: {
				id: { type: "integer" as const, primaryKey: true, autoIncrement: true },
				untappd_venue_id: { type: "text" as const, unique: true },
				slug: { type: "text" as const },
				name: { type: "text" as const, notNull: true },
				url: { type: "text" as const, notNull: true },
				city: { type: "text" as const },
				country: { type: "text" as const },
				created_at: { type: "text" as const, notNull: true },
				updated_at: { type: "text" as const, notNull: true },
				last_menu_scraped_at: { type: "text" as const },
			},
			indexes: [
				{ columns: ["untappd_venue_id"], name: "idx_venues_untappd_id" },
			],
		},
		untappd_breweries: {
			columns: {
				id: { type: "integer" as const, primaryKey: true, autoIncrement: true },
				untappd_brewery_id: { type: "text" as const, unique: true },
				slug: { type: "text" as const, notNull: true },
				name: { type: "text" as const, notNull: true },
				url: { type: "text" as const, notNull: true },
				created_at: { type: "text" as const, notNull: true },
				updated_at: { type: "text" as const, notNull: true },
				last_scraped_at: { type: "text" as const },
			},
			indexes: [
				{ columns: ["untappd_brewery_id"], name: "idx_breweries_untappd_id" },
			],
		},
		untappd_beers: {
			columns: {
				id: { type: "integer" as const, primaryKey: true, autoIncrement: true },
				untappd_beer_id: { type: "text" as const, unique: true },
				name: { type: "text" as const, notNull: true },
				style: { type: "text" as const },
				abv: { type: "real" as const },
				ibu: { type: "real" as const },
				brewery_id: { type: "integer" as const },
				url: { type: "text" as const },
				created_at: { type: "text" as const, notNull: true },
				updated_at: { type: "text" as const, notNull: true },
			},
			indexes: [
				{ columns: ["untappd_beer_id"], name: "idx_beers_untappd_id" },
				{ columns: ["brewery_id"], name: "idx_beers_brewery_id" },
			],
		},
		untappd_venue_menus: {
			columns: {
				id: { type: "integer" as const, primaryKey: true, autoIncrement: true },
				venue_id: { type: "integer" as const, notNull: true },
				name: { type: "text" as const, notNull: true },
				source_tag: { type: "text" as const },
				created_at: { type: "text" as const, notNull: true },
				updated_at: { type: "text" as const, notNull: true },
			},
			indexes: [
				{ columns: ["venue_id"], name: "idx_venue_menus_venue_id" },
			],
		},
		untappd_menu_items: {
			columns: {
				id: { type: "integer" as const, primaryKey: true, autoIncrement: true },
				venue_menu_id: { type: "integer" as const, notNull: true },
				beer_id: { type: "integer" as const },
				display_name: { type: "text" as const, notNull: true },
				price_text: { type: "text" as const },
				section_order: { type: "integer" as const, notNull: true, default: 0 },
				active_confidence: { type: "real" as const, notNull: true, default: 1.0 },
				last_seen_at: { type: "text" as const },
				created_at: { type: "text" as const, notNull: true },
				updated_at: { type: "text" as const, notNull: true },
			},
			indexes: [
				{ columns: ["venue_menu_id"], name: "idx_menu_items_venue_menu_id" },
				{ columns: ["beer_id"], name: "idx_menu_items_beer_id" },
			],
		},
		untappd_users: {
			columns: {
				id: { type: "integer" as const, primaryKey: true, autoIncrement: true },
				username: { type: "text" as const, notNull: true, unique: true },
				display_name: { type: "text" as const },
				rss_url: { type: "text" as const, notNull: true },
				url: { type: "text" as const },
				created_at: { type: "text" as const, notNull: true },
				updated_at: { type: "text" as const, notNull: true },
			},
		},
		untappd_rss_sources: {
			columns: {
				id: { type: "integer" as const, primaryKey: true, autoIncrement: true },
				type: { type: "text" as const, notNull: true },
				foreign_id: { type: "integer" as const, notNull: true },
				rss_url: { type: "text" as const, notNull: true },
				poll_interval_minutes: { type: "integer" as const, notNull: true, default: 15 },
				last_polled_at: { type: "text" as const },
				enabled: { type: "integer" as const, notNull: true, default: 1 },
				created_at: { type: "text" as const, notNull: true },
				updated_at: { type: "text" as const, notNull: true },
			},
			indexes: [
				{ columns: ["type", "foreign_id"], name: "idx_rss_sources_type_foreign_id", unique: true },
			],
		},
		untappd_activity_events: {
			columns: {
				id: { type: "integer" as const, primaryKey: true, autoIncrement: true },
				rss_source_id: { type: "integer" as const, notNull: true },
				event_type: { type: "text" as const, notNull: true },
				untappd_checkin_id: { type: "text" as const, unique: true },
				untappd_beer_id: { type: "text" as const },
				beer_id: { type: "integer" as const },
				venue_id: { type: "integer" as const },
				user_id: { type: "integer" as const },
				user_username: { type: "text" as const },
				beer_name: { type: "text" as const, notNull: true },
				venue_untappd_id: { type: "text" as const },
				payload_raw: { type: "text" as const, notNull: true },
				occurred_at: { type: "text" as const, notNull: true },
				created_at: { type: "text" as const, notNull: true },
			},
			indexes: [
				{ columns: ["rss_source_id"], name: "idx_activity_events_rss_source_id" },
				{ columns: ["occurred_at"], name: "idx_activity_events_occurred_at" },
				{ columns: ["beer_id"], name: "idx_activity_events_beer_id" },
				{ columns: ["venue_id"], name: "idx_activity_events_venue_id" },
			],
		},
		// Forward-compatibility: table scaffolded for future preference/filter rules.
		// No operations, API endpoints, or UI yet — intentionally empty.
		untappd_preference_rules: {
			columns: {
				id: { type: "integer" as const, primaryKey: true, autoIncrement: true },
				rule_name: { type: "text" as const, notNull: true },
				rss_source_id: { type: "integer" as const, notNull: true },
				include_styles: { type: "text" as const },
				exclude_styles: { type: "text" as const },
				min_abv: { type: "real" as const },
				max_abv: { type: "real" as const },
				favorite_breweries: { type: "text" as const },
				only_new_beers: { type: "integer" as const, notNull: true, default: 0 },
				created_at: { type: "text" as const, notNull: true },
				updated_at: { type: "text" as const, notNull: true },
			},
			indexes: [
				{ columns: ["rss_source_id"], name: "idx_preference_rules_rss_source_id" },
			],
		},
	},
};
