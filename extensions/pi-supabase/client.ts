/**
 * pi-supabase — Supabase client singleton.
 *
 * Creates and manages a Supabase JS client instance.
 * Supports both anon key and service role key access.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SupabaseSettings } from "./settings.ts";

let client: SupabaseClient | null = null;

export function getClient(): SupabaseClient {
	if (!client) throw new Error("Supabase client not initialized — check pi-supabase settings");
	return client;
}

export function isClientReady(): boolean {
	return client !== null;
}

export function initClient(settings: SupabaseSettings): SupabaseClient {
	if (!settings.url) throw new Error("pi-supabase: 'url' is required in settings");

	const key = settings.useServiceRole
		? settings.serviceRoleKey
		: settings.anonKey;

	if (!key) {
		const keyName = settings.useServiceRole ? "serviceRoleKey" : "anonKey";
		throw new Error(`pi-supabase: '${keyName}' is required in settings`);
	}

	client = createClient(settings.url, key, {
		auth: {
			autoRefreshToken: false,
			persistSession: false,
		},
	});

	return client;
}

export function resetClient(): void {
	client = null;
}
