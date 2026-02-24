/**
 * pi-model-router — LLM classifier.
 *
 * Calls a cheap/fast model to classify a prompt's complexity into a tier.
 * Uses pi's model registry for auth and endpoint resolution — no separate
 * API keys or URLs needed.
 *
 * Supports OpenAI-compatible and Anthropic API formats.
 */

import type { Api, Model } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { ClassifierSettings, Tier } from "./settings.ts";

// ── Classifier prompt ───────────────────────────────────────────

const SYSTEM_PROMPT = `You are a task complexity classifier. Given a task description, classify it into exactly one tier.

Return ONLY a JSON object with no other text: {"tier":"simple"|"medium"|"complex"}

simple = status checks, health pings, lookups, data retrieval, short answers, listing items, yes/no questions
medium = analysis, code review, moderate coding, summarization, planning, debugging, refactoring
complex = long-form writing, blog posts, multi-step reasoning, architecture design, creative work, research`;

// ── Model resolution ────────────────────────────────────────────

/**
 * Resolve classifier model from the registry by pattern.
 * Tries exact ID match, then partial ID, then partial name.
 */
function findClassifierModel(
	pattern: string,
	modelRegistry: ModelRegistry,
): Model<Api> | undefined {
	const allModels = modelRegistry.getAll();
	const p = pattern.toLowerCase();

	// Handle "provider/model" format
	if (pattern.includes("/")) {
		const [provider, modelId] = pattern.split("/", 2);
		return modelRegistry.find(provider, modelId);
	}

	// Exact ID
	const exact = allModels.find((m) => m.id.toLowerCase() === p);
	if (exact) return exact;

	// Partial ID (prefer shorter = alias over dated)
	const idMatches = allModels
		.filter((m) => m.id.toLowerCase().includes(p))
		.sort((a, b) => a.id.length - b.id.length);
	if (idMatches.length > 0) return idMatches[0];

	// Partial name
	const nameMatches = allModels
		.filter((m) => m.name.toLowerCase().includes(p))
		.sort((a, b) => a.name.length - b.name.length);
	if (nameMatches.length > 0) return nameMatches[0];

	return undefined;
}

// ── API call helpers ────────────────────────────────────────────

async function callOpenAICompatible(
	model: Model<Api>,
	apiKey: string,
	taskText: string,
	timeoutMs: number,
): Promise<string | null> {
	if (!model.baseUrl) return null;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		// OpenAI-compatible endpoint: baseUrl + /chat/completions
		const url = model.baseUrl.replace(/\/+$/, "") + "/chat/completions";

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
			...(model.headers ?? {}),
		};

		const response = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify({
				model: model.id,
				messages: [
					{ role: "system", content: SYSTEM_PROMPT },
					{ role: "user", content: `Task: ${taskText}` },
				],
				max_tokens: 50,
				temperature: 0,
			}),
			signal: controller.signal,
		});

		if (!response.ok) return null;
		const data = (await response.json()) as any;
		return data?.choices?.[0]?.message?.content?.trim() ?? null;
	} finally {
		clearTimeout(timeout);
	}
}

async function callAnthropic(
	model: Model<Api>,
	apiKey: string,
	taskText: string,
	timeoutMs: number,
): Promise<string | null> {
	if (!model.baseUrl) return null;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const url = model.baseUrl.replace(/\/+$/, "") + "/messages";

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
			...(model.headers ?? {}),
		};

		const response = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify({
				model: model.id,
				system: SYSTEM_PROMPT,
				messages: [{ role: "user", content: `Task: ${taskText}` }],
				max_tokens: 50,
				temperature: 0,
			}),
			signal: controller.signal,
		});

		if (!response.ok) return null;
		const data = (await response.json()) as any;
		return data?.content?.[0]?.text?.trim() ?? null;
	} finally {
		clearTimeout(timeout);
	}
}

async function callGoogle(
	model: Model<Api>,
	apiKey: string,
	taskText: string,
	timeoutMs: number,
): Promise<string | null> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent`;

		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-goog-api-key": apiKey,
				...(model.headers ?? {}),
			},
			body: JSON.stringify({
				systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
				contents: [{ role: "user", parts: [{ text: `Task: ${taskText}` }] }],
				generationConfig: { maxOutputTokens: 50, temperature: 0 },
			}),
			signal: controller.signal,
		});

		if (!response.ok) return null;
		const data = (await response.json()) as any;
		return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
	} finally {
		clearTimeout(timeout);
	}
}

// ── Main classify function ──────────────────────────────────────

/**
 * Classify a prompt using the configured model from pi's registry.
 * Returns the tier, or null if classification fails.
 */
export async function classify(
	prompt: string,
	settings: ClassifierSettings,
	modelRegistry: ModelRegistry,
): Promise<Tier | null> {
	// Resolve model from registry
	const model = findClassifierModel(settings.model, modelRegistry);
	if (!model) return null;

	// Get API key from registry
	const apiKey = await modelRegistry.getApiKey(model);
	if (!apiKey) return null;

	const taskText = prompt.slice(0, 500).replace(/\s+/g, " ").trim();

	try {
		let content: string | null = null;

		// Route to the right API format based on model.api
		switch (model.api) {
			case "anthropic-messages":
				content = await callAnthropic(model, apiKey, taskText, settings.timeoutMs);
				break;
			case "google-generative-ai":
				content = await callGoogle(model, apiKey, taskText, settings.timeoutMs);
				break;
			case "google-vertex":
				// Vertex AI uses a different endpoint and auth scheme — not yet supported.
				// Falls through to return null → default tier.
				return null;
			default:
				// OpenAI-compatible covers: openai-completions, openai-responses,
				// minimax, groq, openrouter, xai, cerebras, mistral, etc.
				content = await callOpenAICompatible(model, apiKey, taskText, settings.timeoutMs);
				break;
		}

		if (!content) return null;

		// Parse JSON response — handle both raw JSON and markdown-wrapped JSON
		const jsonMatch = content.match(/\{[^}]*\}/);
		if (!jsonMatch) return null;

		const parsed = JSON.parse(jsonMatch[0]);
		const tier = parsed?.tier;

		if (tier === "simple" || tier === "medium" || tier === "complex") {
			return tier;
		}

		return null;
	} catch {
		// Network error, timeout, parse error — all fall back to null
		return null;
	}
}
