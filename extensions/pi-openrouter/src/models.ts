import { getAgentDir } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Raw model from OpenRouter /api/v1/models */
export interface OpenRouterModel {
	id: string;
	name: string;
	context_length: number;
	architecture: {
		modality: string;
		input_modalities: string[];
		output_modalities: string[];
	};
	pricing: {
		prompt: string;
		completion: string;
		input_cache_read?: string;
		input_cache_write?: string;
	};
	top_provider: {
		context_length: number;
		max_completion_tokens: number;
		is_moderated: boolean;
	};
	supported_parameters: string[];
}

/** Model config for pi's registerProvider */
export interface ProviderModelConfig {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
}

// ─── Cache ───────────────────────────────────────────────────────────────────

function getCachePath(): string {
	return path.join(getAgentDir(), "cache", "openrouter-models.json");
}

export function loadCache(): OpenRouterModel[] {
	try {
		const data = fs.readFileSync(getCachePath(), "utf-8");
		const parsed = JSON.parse(data) as { models: OpenRouterModel[]; timestamp: number };
		return Array.isArray(parsed.models) ? parsed.models : [];
	} catch {
		return [];
	}
}

export function saveCache(models: OpenRouterModel[]): void {
	const cachePath = getCachePath();
	const dir = path.dirname(cachePath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	fs.writeFileSync(cachePath, JSON.stringify({ models, timestamp: Date.now() }, null, 2));
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

const MODELS_URL = "https://openrouter.ai/api/v1/models";

export async function fetchModels(): Promise<OpenRouterModel[]> {
	const response = await fetch(MODELS_URL, {
		headers: { Accept: "application/json" },
		signal: AbortSignal.timeout(10_000),
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch OpenRouter models: ${response.status} ${response.statusText}`);
	}

	const data = (await response.json()) as { data: OpenRouterModel[] };
	return data.data ?? [];
}

// ─── Filter ──────────────────────────────────────────────────────────────────

function patternToRegex(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp(`^${escaped}$`);
}

export function filterModels(models: OpenRouterModel[], patterns: string[]): OpenRouterModel[] {
	const regexes = patterns.map(patternToRegex);
	return models.filter((m) => regexes.some((r) => r.test(m.id)));
}

// ─── Map ─────────────────────────────────────────────────────────────────────

function safeFloat(s?: string): number {
	const n = parseFloat(s ?? "0");
	return isFinite(n) ? n : 0;
}

export function toProviderModel(m: OpenRouterModel): ProviderModelConfig {
	const pricing = m.pricing ?? {};
	const inputModalities = m.architecture?.input_modalities ?? ["text"];
	const hasImage = inputModalities.includes("image");
	const hasReasoning = m.supported_parameters?.includes("include_reasoning") ?? false;

	return {
		id: m.id,
		name: m.name,
		reasoning: hasReasoning,
		input: hasImage ? ["text", "image"] : ["text"],
		cost: {
			input: safeFloat(pricing.prompt) * 1_000_000,
			output: safeFloat(pricing.completion) * 1_000_000,
			cacheRead: safeFloat(pricing.input_cache_read) * 1_000_000,
			cacheWrite: safeFloat(pricing.input_cache_write) * 1_000_000,
		},
		contextWindow: m.context_length ?? 128000,
		maxTokens: m.top_provider?.max_completion_tokens ?? 16384,
	};
}
