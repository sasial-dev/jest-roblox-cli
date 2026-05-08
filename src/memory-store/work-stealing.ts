import { randomUUID } from "node:crypto";

import type { MemoryStoreQueueClient } from "./queue-client.ts";

const DEFAULT_TTL_SECONDS = 600;
const INVISIBILITY_BUFFER_SECONDS = 30;

interface QueueItem {
	pkg: string;
	project: string;
}

interface PrepareWorkStealingOptions {
	packages: ReadonlyArray<QueueItem>;
	perPackageTimeoutSeconds: number;
	queueClient: MemoryStoreQueueClient;
	/** TTL for queue items in seconds. Default 600 (10 min). */
	ttlSeconds?: number;
	/** Override the UUID generator (default: `crypto.randomUUID`). */
	uuid?: () => string;
}

interface PreparedWorkStealing {
	/** Materializer-side invisibility window = perPackageTimeoutSeconds + 30. */
	invisibilityWindowSeconds: number;
	/** Per-run UUID-keyed queue name. */
	queueId: string;
}

/**
 * Generate a per-run queue ID, push every package onto it with the given TTL,
 * and report the queueId + the invisibility window the materializer should
 * use when popping. Each parallel OCALE task pops from this queue until it
 * is empty (work-stealing); the invisibility window covers per-package
 * execution plus a small buffer so a crashing task lets its in-flight
 * package become visible again to siblings.
 */
export async function prepareWorkStealingQueue(
	options: PrepareWorkStealingOptions,
): Promise<PreparedWorkStealing> {
	const queueId = (options.uuid ?? randomUUID)();
	const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
	for (const entry of options.packages) {
		await options.queueClient.add(
			queueId,
			{ pkg: entry.pkg, project: entry.project },
			{ ttlSeconds },
		);
	}

	return {
		invisibilityWindowSeconds: options.perPackageTimeoutSeconds + INVISIBILITY_BUFFER_SECONDS,
		queueId,
	};
}
