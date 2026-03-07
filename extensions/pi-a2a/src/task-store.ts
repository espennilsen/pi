/**
 * pi-a2a — In-memory task store.
 *
 * Tracks A2A tasks and their state. Personal agent — low volume,
 * in-memory is fine. Tasks expire after 1 hour.
 */

import { randomUUID } from "node:crypto";
import type { Task, TaskState, Message, Artifact } from "./types.ts";

const TASK_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_TASKS = 100;

const tasks = new Map<string, Task>();

export function createTask(contextId?: string): Task {
	// Evict old tasks if over limit
	if (tasks.size >= MAX_TASKS) {
		const oldest = [...tasks.entries()]
			.sort((a, b) => {
				const ta = a[1].status.timestamp ?? "";
				const tb = b[1].status.timestamp ?? "";
				return ta.localeCompare(tb);
			})
			.slice(0, tasks.size - MAX_TASKS + 1);
		for (const [id] of oldest) {
			tasks.delete(id);
		}
	}

	const task: Task = {
		id: randomUUID(),
		contextId: contextId ?? randomUUID(),
		status: {
			state: "submitted",
			timestamp: new Date().toISOString(),
		},
		history: [],
		artifacts: [],
	};
	tasks.set(task.id, task);
	return task;
}

export function getTask(id: string): Task | undefined {
	const task = tasks.get(id);
	if (!task) return undefined;

	// Expire old tasks
	const ts = task.status.timestamp;
	if (ts && Date.now() - new Date(ts).getTime() > TASK_TTL_MS) {
		tasks.delete(id);
		return undefined;
	}
	return task;
}

export function updateTaskState(id: string, state: TaskState, message?: Message): Task | undefined {
	const task = tasks.get(id);
	if (!task) return undefined;

	task.status = {
		state,
		message,
		timestamp: new Date().toISOString(),
	};
	return task;
}

export function appendMessage(id: string, message: Message): Task | undefined {
	const task = tasks.get(id);
	if (!task) return undefined;

	task.history ??= [];
	task.history.push(message);
	return task;
}

export function addArtifact(id: string, artifact: Artifact): Task | undefined {
	const task = tasks.get(id);
	if (!task) return undefined;

	task.artifacts ??= [];
	task.artifacts.push(artifact);
	return task;
}

export function cancelTask(id: string): Task | undefined {
	return updateTaskState(id, "canceled");
}

export function listTasks(): Task[] {
	return [...tasks.values()];
}
