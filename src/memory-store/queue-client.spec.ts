import { describe, expect, it, vi } from "vitest";

import type { HttpClient, HttpResponse } from "../backends/http-client.ts";
import { MemoryStoreQueueClient } from "./queue-client.ts";

interface RecordedCall {
	body?: unknown;
	headers?: Record<string, string | undefined>;
	method: string;
	url: string;
}

interface MockOptions {
	addResponse?: HttpResponse;
	discardResponse?: HttpResponse;
	readResponse?: HttpResponse;
}

const ADD_OK: HttpResponse = { body: {}, ok: true, status: 200 };
const READ_OK: HttpResponse = { body: { id: "read-1", items: [] }, ok: true, status: 200 };
const DISCARD_OK: HttpResponse = { body: {}, ok: true, status: 200 };

function createHttpMock(options: MockOptions = {}): HttpClient & { calls: Array<RecordedCall> } {
	const calls: Array<RecordedCall> = [];
	return {
		calls,
		async request(method, url, requestOptions) {
			calls.push({
				body: requestOptions?.body,
				headers: requestOptions?.headers,
				method,
				url,
			});
			if (url.includes(":read")) {
				return options.readResponse ?? READ_OK;
			}

			if (url.includes(":discard")) {
				return options.discardResponse ?? DISCARD_OK;
			}

			return options.addResponse ?? ADD_OK;
		},
	};
}

const credentials = { apiKey: "test-api-key", universeId: "123" };

describe(MemoryStoreQueueClient, () => {
	describe("add", () => {
		it("should POST the item to the Open Cloud MemoryStore Queue items endpoint", async () => {
			expect.assertions(2);

			const http = createHttpMock();
			const client = new MemoryStoreQueueClient(credentials, { http });

			await client.add("my-queue", "package-a", { ttlSeconds: 600 });

			expect(http.calls).toHaveLength(1);
			expect(http.calls[0]?.url).toBe(
				"https://apis.roblox.com/cloud/v2/universes/123/memory-store/queues/my-queue/items",
			);
		});

		it("should send the value as `data`, expiration, and default priority in the body", async () => {
			expect.assertions(2);

			const http = createHttpMock();
			const client = new MemoryStoreQueueClient(credentials, { http });

			await client.add("q", { name: "@halcyon/foo" }, { ttlSeconds: 600 });

			expect(http.calls[0]?.method).toBe("POST");
			expect(http.calls[0]?.body).toStrictEqual({
				data: { name: "@halcyon/foo" },
				expiration: "600s",
				priority: 0,
			});
		});

		it("should pass priority through when provided", async () => {
			expect.assertions(1);

			const http = createHttpMock();
			const client = new MemoryStoreQueueClient(credentials, { http });

			await client.add("q", "value", { priority: 5, ttlSeconds: 60 });

			expect((http.calls[0]?.body as undefined | { priority: number })?.priority).toBe(5);
		});

		it("should throw when the add response is not ok", async () => {
			expect.assertions(1);

			const http = createHttpMock({
				addResponse: { body: { error: "Forbidden" }, ok: false, status: 403 },
			});
			const client = new MemoryStoreQueueClient(credentials, { http });

			await expect(client.add("q", "v", { ttlSeconds: 60 })).rejects.toThrow(
				/Failed to add queue item: 403/,
			);
		});
	});

	describe("read", () => {
		it("should POST to the queue items :read endpoint with invisibility window and count", async () => {
			expect.assertions(3);

			const http = createHttpMock({
				readResponse: {
					body: { id: "read-token-1", items: ["package-a", "package-b"] },
					ok: true,
					status: 200,
				},
			});
			const client = new MemoryStoreQueueClient(credentials, { http });

			await client.read("my-queue", { count: 1, invisibilityWindowSeconds: 90 });

			expect(http.calls[0]?.method).toBe("POST");
			expect(http.calls[0]?.url).toBe(
				"https://apis.roblox.com/cloud/v2/universes/123/memory-store/queues/my-queue/items:read",
			);
			expect(http.calls[0]?.body).toStrictEqual({
				count: 1,
				invisibilityWindow: "90s",
			});
		});

		it("should return the read id and items from the response", async () => {
			expect.assertions(2);

			const http = createHttpMock({
				readResponse: {
					body: { id: "abc123", items: [{ pkg: "@halcyon/foo" }] },
					ok: true,
					status: 200,
				},
			});
			const client = new MemoryStoreQueueClient(credentials, { http });

			const result = await client.read<{ pkg: string }>("q", {
				count: 1,
				invisibilityWindowSeconds: 30,
			});

			expect(result.id).toBe("abc123");
			expect(result.items).toStrictEqual([{ pkg: "@halcyon/foo" }]);
		});

		it("should default to an empty items array when the response omits it", async () => {
			expect.assertions(2);

			const http = createHttpMock({
				readResponse: { body: { id: "empty-1" }, ok: true, status: 200 },
			});
			const client = new MemoryStoreQueueClient(credentials, { http });

			const result = await client.read("q", { count: 1, invisibilityWindowSeconds: 30 });

			expect(result.id).toBe("empty-1");
			expect(result.items).toStrictEqual([]);
		});

		it("should throw when the read response is not ok", async () => {
			expect.assertions(1);

			const http = createHttpMock({
				readResponse: { body: {}, ok: false, status: 500 },
			});
			const client = new MemoryStoreQueueClient(credentials, { http });

			await expect(
				client.read("q", { count: 1, invisibilityWindowSeconds: 30 }),
			).rejects.toThrow(/Failed to read queue items: 500/);
		});
	});

	describe("discard", () => {
		it("should POST to the queue items :discard endpoint with the readId", async () => {
			expect.assertions(3);

			const http = createHttpMock();
			const client = new MemoryStoreQueueClient(credentials, { http });

			await client.discard("my-queue", "read-token-1");

			expect(http.calls[0]?.method).toBe("POST");
			expect(http.calls[0]?.url).toBe(
				"https://apis.roblox.com/cloud/v2/universes/123/memory-store/queues/my-queue/items:discard",
			);
			expect(http.calls[0]?.body).toStrictEqual({ readId: "read-token-1" });
		});

		it("should throw when the discard response is not ok", async () => {
			expect.assertions(1);

			const http = createHttpMock({
				discardResponse: { body: {}, ok: false, status: 404 },
			});
			const client = new MemoryStoreQueueClient(credentials, { http });

			await expect(client.discard("q", "missing")).rejects.toThrow(
				/Failed to discard queue items: 404/,
			);
		});
	});

	it("should honor JEST_ROBLOX_OPEN_CLOUD_BASE_URL when constructing URLs", async () => {
		expect.assertions(1);

		vi.stubEnv("JEST_ROBLOX_OPEN_CLOUD_BASE_URL", "http://127.0.0.1:4010/custom/");

		const http = createHttpMock();
		const client = new MemoryStoreQueueClient(credentials, { http });

		await client.add("q", "v", { ttlSeconds: 60 });

		expect(http.calls[0]?.url).toBe(
			"http://127.0.0.1:4010/custom/cloud/v2/universes/123/memory-store/queues/q/items",
		);
	});

	it("should construct a default fetch client when none is provided", () => {
		expect.assertions(1);

		const client = new MemoryStoreQueueClient(credentials);

		expect(Reflect.get(client, "http")).toBeDefined();
	});
});
