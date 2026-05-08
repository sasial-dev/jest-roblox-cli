import { describe, expect, it, vi } from "vitest";

import { MemoryStoreQueueClient } from "./queue-client.ts";
import { prepareWorkStealingQueue } from "./work-stealing.ts";

interface AddCall {
	options: { priority?: number; ttlSeconds: number };
	queue: string;
	value: unknown;
}

function createQueueClientStub(addImpl?: () => Promise<void>): {
	addCalls: Array<AddCall>;
	client: MemoryStoreQueueClient;
} {
	const addCalls: Array<AddCall> = [];
	const client: MemoryStoreQueueClient = Object.create(MemoryStoreQueueClient.prototype);
	vi.spyOn(client, "add").mockImplementation(
		async (queue: string, value: unknown, options: AddCall["options"]): Promise<void> => {
			addCalls.push({ options, queue, value });
			if (addImpl) {
				await addImpl();
			}
		},
	);
	return { addCalls, client };
}

describe(prepareWorkStealingQueue, () => {
	it("should push every package onto a per-run UUID-keyed queue with default TTL", async () => {
		expect.assertions(2);

		const { addCalls, client } = createQueueClientStub();
		const uuid = vi.fn<() => string>().mockReturnValue("queue-uuid-1");

		await prepareWorkStealingQueue({
			packages: [
				{ pkg: "@halcyon/foo", project: "alpha" },
				{ pkg: "@halcyon/bar", project: "beta" },
			],
			perPackageTimeoutSeconds: 60,
			queueClient: client,
			uuid,
		});

		expect(addCalls).toHaveLength(2);
		expect(
			addCalls.every(
				(call) => call.queue === "queue-uuid-1" && call.options.ttlSeconds === 600,
			),
		).toBeTrue();
	});

	it("should accept a custom ttlSeconds override", async () => {
		expect.assertions(1);

		const { addCalls, client } = createQueueClientStub();

		await prepareWorkStealingQueue({
			packages: [{ pkg: "@halcyon/foo", project: "alpha" }],
			perPackageTimeoutSeconds: 60,
			queueClient: client,
			ttlSeconds: 120,
			uuid: () => "qid",
		});

		expect(addCalls[0]?.options.ttlSeconds).toBe(120);
	});

	it("should set invisibilityWindowSeconds to perPackageTimeoutSeconds + 30", async () => {
		expect.assertions(1);

		const { client } = createQueueClientStub();

		const prepared = await prepareWorkStealingQueue({
			packages: [],
			perPackageTimeoutSeconds: 60,
			queueClient: client,
			uuid: () => "qid",
		});

		expect(prepared.invisibilityWindowSeconds).toBe(90);
	});

	it("should return the queueId produced by the injected uuid generator", async () => {
		expect.assertions(1);

		const { client } = createQueueClientStub();

		const prepared = await prepareWorkStealingQueue({
			packages: [],
			perPackageTimeoutSeconds: 60,
			queueClient: client,
			uuid: () => "specific-uuid",
		});

		expect(prepared.queueId).toBe("specific-uuid");
	});

	it("should push the pkg+project pair as the queue value (not the full input)", async () => {
		expect.assertions(1);

		const { addCalls, client } = createQueueClientStub();

		await prepareWorkStealingQueue({
			packages: [{ pkg: "@halcyon/foo", project: "alpha" }],
			perPackageTimeoutSeconds: 60,
			queueClient: client,
			uuid: () => "qid",
		});

		expect(addCalls[0]?.value).toStrictEqual({ pkg: "@halcyon/foo", project: "alpha" });
	});

	it("should skip pushes and still return queueId for an empty packages array", async () => {
		expect.assertions(2);

		const { addCalls, client } = createQueueClientStub();

		const prepared = await prepareWorkStealingQueue({
			packages: [],
			perPackageTimeoutSeconds: 60,
			queueClient: client,
			uuid: () => "qid",
		});

		expect(addCalls).toHaveLength(0);
		expect(prepared.queueId).toBe("qid");
	});

	it("should propagate errors from queueClient.add and stop further pushes", async () => {
		expect.assertions(2);

		let callsBeforeFailure = 0;
		const { addCalls, client } = createQueueClientStub(async () => {
			callsBeforeFailure++;
			if (callsBeforeFailure === 2) {
				throw new Error("queue full");
			}
		});

		await expect(
			prepareWorkStealingQueue({
				packages: [
					{ pkg: "alpha", project: "p1" },
					{ pkg: "beta", project: "p2" },
					{ pkg: "gamma", project: "p3" },
				],
				perPackageTimeoutSeconds: 60,
				queueClient: client,
				uuid: () => "qid",
			}),
		).rejects.toThrow("queue full");

		expect(addCalls).toHaveLength(2);
	});

	it("should default to crypto.randomUUID when no uuid override is provided", async () => {
		expect.assertions(1);

		const { client } = createQueueClientStub();

		const prepared = await prepareWorkStealingQueue({
			packages: [],
			perPackageTimeoutSeconds: 60,
			queueClient: client,
		});

		expect(prepared.queueId).toMatch(
			/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/,
		);
	});
});
