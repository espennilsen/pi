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
import { findModel } from "./match.ts";

// ── Classifier prompt ───────────────────────────────────────────

const SYSTEM_PROMPT = `You are a task complexity classifier. Given a task description, classify it into exactly one tier.

Return ONLY a JSON object with no other text: {"tier":"simple"|"medium"|"complex"}

simple = status checks, health pings, lookups, data retrieval, short answers, listing items, yes/no questions
medium = analysis, code review, moderate coding, summarization, planning, debugging, refactoring
complex = long-form writing, blog posts, multi-step reasoning, architecture design, creative work, research`;

// ── Default base URLs ───────────────────────────────────────────

const OPENAI_DEFAULT_BASE = "https://api.openai.com/v1";
const ANTHROPIC_DEFAULT_BASE = "https://api.anthropic.com/v1";

// ── API call helpers ────────────────────────────────────────────

type LogFn = (event: string, data: unknown, level?: string) => void;

async function callOpenAICompatible(
	model: Model<Api>,
	apiKey: string,
	taskText: string,
	timeoutMs: number,
	log?: LogFn,
): Promise<string | null> {
	const base = (model.baseUrl ?? OPENAI_DEFAULT_BASE).replace(/\/+$/, "");

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const url = base + "/chat/completions";

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			...(model.headers ?? {}),
			Authorization: `Bearer ${apiKey}`,
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

		if (!response.ok) {
			log?.("classify-http-error", { status: response.status, model: model.id, api: "openai-compatible" }, "WARN");
			return null;
		}
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
	log?: LogFn,
): Promise<string | null> {
	const base = (model.baseUrl ?? ANTHROPIC_DEFAULT_BASE).replace(/\/+$/, "");

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const url = base + "/messages";

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			...(model.headers ?? {}),
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
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

		if (!response.ok) {
			log?.("classify-http-error", { status: response.status, model: model.id, api: "anthropic" }, "WARN");
			return null;
		}
		const data = (await response.json()) as any;
		return data?.content?.[0]?.text?.trim() ?? null;
	} finally {
		clearTimeout(timeout);
	}
}

const GOOGLE_DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";

async function callGoogle(
	model: Model<Api>,
	apiKey: string,
	taskText: string,
	timeoutMs: number,
	log?: LogFn,
): Promise<string | null> {
	const base = (model.baseUrl ?? GOOGLE_DEFAULT_BASE).replace(/\/+$/, "");

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const modelId = model.id.replace(/^models\//, "");
		const url = `${base}/models/${modelId}:generateContent`;

		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(model.headers ?? {}),
				"x-goog-api-key": apiKey,
			},
			body: JSON.stringify({
				systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
				contents: [{ role: "user", parts: [{ text: `Task: ${taskText}` }] }],
				generationConfig: { maxOutputTokens: 50, temperature: 0 },
			}),
			signal: controller.signal,
		});

		if (!response.ok) {
			log?.("classify-http-error", { status: response.status, model: model.id, api: "google" }, "WARN");
			return null;
		}
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
	log?: LogFn,
): Promise<Tier | null> {
	// Resolve model from registry
	const model = findModel(settings.model, modelRegistry);
	if (!model) return null;

	const taskText = prompt.slice(0, 500).replace(/\s+/g, " ").trim();

	try {
		// Get API key from registry (inside try so failures hit the catch)
		const apiKey = await modelRegistry.getApiKey(model);
		if (!apiKey) return null;
		let content: string | null = null;

		// Route to the right API format based on model.api
		switch (model.api) {
			case "anthropic-messages":
				content = await callAnthropic(model, apiKey, taskText, settings.timeoutMs, log);
				break;
			case "google-generative-ai":
				content = await callGoogle(model, apiKey, taskText, settings.timeoutMs, log);
				break;
			case "google-vertex":
				// Vertex AI uses a different endpoint and auth scheme — not yet supported.
				log?.("classifier-unsupported", { api: "google-vertex", model: model.id }, "WARN");
				return null;
			default:
				// OpenAI-compatible covers: openai-completions, openai-responses,
				// minimax, groq, openrouter, xai, cerebras, mistral, etc.
				content = await callOpenAICompatible(model, apiKey, taskText, settings.timeoutMs, log);
				break;
		}

		if (!content) return null;

		// Parse JSON response — try direct parse first, then regex extraction
		// for markdown-fenced or wrapped responses
		let parsed: any;
		try {
			parsed = JSON.parse(content);
		} catch {
			const start = content.indexOf("{");
			const end = content.lastIndexOf("}");
			if (start === -1 || end <= start) return null;
			parsed = JSON.parse(content.slice(start, end + 1));
		}
		const tier = parsed?.tier;

		if (tier === "simple" || tier === "medium" || tier === "complex") {
			return tier;
		}

		return null;
	} catch (err) {
		log?.("classify-error", { model: settings.model, error: String(err) }, "WARN");
		return null;
	}
}
