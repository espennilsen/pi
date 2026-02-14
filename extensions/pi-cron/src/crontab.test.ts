/**
 * Tests for crontab serialize/parse — especially multi-line prompt handling.
 *
 * Run: npx tsx --test src/crontab.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parse, serialize, type CronJob } from "./crontab.ts";

describe("serialize", () => {
	it("collapses newlines in prompts to single spaces", () => {
		const jobs: CronJob[] = [{
			name: "multi-line",
			schedule: "0 9 * * *",
			prompt: "Line one\nLine two\nLine three",
			channel: "cron",
			disabled: false,
		}];

		const output = serialize(jobs);
		const lines = output.split("\n").filter(l => l && !l.startsWith("#"));
		assert.equal(lines.length, 1, "should produce exactly one job line");
		assert.ok(lines[0].includes("Line one Line two Line three"), "newlines should be collapsed to spaces");
	});

	it("collapses \\r\\n and excess whitespace", () => {
		const jobs: CronJob[] = [{
			name: "crlf-test",
			schedule: "*/5 * * * *",
			prompt: "First\r\nSecond\r\n\r\nThird   extra   spaces",
			channel: "cron",
			disabled: false,
		}];

		const output = serialize(jobs);
		const lines = output.split("\n").filter(l => l && !l.startsWith("#"));
		assert.equal(lines.length, 1);
		assert.ok(!lines[0].includes("\r"), "should not contain \\r");
		assert.ok(!lines[0].includes("\n\n"), "should not contain consecutive newlines");
		assert.ok(lines[0].includes("First Second Third extra spaces"), "excess whitespace should be collapsed");
	});
});

describe("parse → serialize round-trip", () => {
	it("serialize(parse(serialize(jobs))) is idempotent when prompts contain newlines", () => {
		const jobs: CronJob[] = [
			{
				name: "daily-standup",
				schedule: "0 9 * * 1-5",
				prompt: "Review my td tasks\nand summarize what's open\n\nInclude blockers",
				channel: "cron",
				disabled: false,
			},
			{
				name: "health-check",
				schedule: "*/15 * * * *",
				prompt: "Check system health\nreport any issues",
				channel: "ops",
				disabled: false,
			},
			{
				name: "weekly-digest",
				schedule: "0 0 * * 0",
				prompt: "Summarize the week",
				channel: "cron",
				disabled: true,
			},
		];

		const first = serialize(jobs);
		const parsed = parse(first);
		const second = serialize(parsed);

		assert.equal(first, second, "serialize(parse(serialize(jobs))) should be idempotent");

		// Also verify job count is preserved
		assert.equal(parsed.length, jobs.length, "should parse same number of jobs");
	});

	it("preserves all job fields through round-trip", () => {
		const jobs: CronJob[] = [{
			name: "test-job",
			schedule: "30 14 * * *",
			prompt: "Do something\nimportant\nwith multiple lines",
			channel: "alerts",
			disabled: true,
		}];

		const parsed = parse(serialize(jobs));
		assert.equal(parsed.length, 1);
		assert.equal(parsed[0].name, "test-job");
		assert.equal(parsed[0].schedule, "30 14 * * *");
		assert.equal(parsed[0].channel, "alerts");
		assert.equal(parsed[0].disabled, true);
		// Prompt should have newlines collapsed
		assert.equal(parsed[0].prompt, "Do something important with multiple lines");
	});
});

describe("parse", () => {
	it("skips blank lines and comments", () => {
		const content = `
# comment
   
0 9 * * * my-job  Hello world
# another comment
`;
		const jobs = parse(content);
		assert.equal(jobs.length, 1);
		assert.equal(jobs[0].name, "my-job");
	});

	it("parses channel and disabled flags", () => {
		const content = `0 9 * * * flagged-job channel:ops disabled Do the thing`;
		const jobs = parse(content);
		assert.equal(jobs.length, 1);
		assert.equal(jobs[0].channel, "ops");
		assert.equal(jobs[0].disabled, true);
		assert.equal(jobs[0].prompt, "Do the thing");
	});
});
