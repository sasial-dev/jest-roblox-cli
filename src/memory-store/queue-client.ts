import { createFetchClient } from "@isentinel/roblox-runner";
import type { HttpClient } from "@isentinel/roblox-runner";

import process from "node:process";

const DEFAULT_OPEN_CLOUD_BASE_URL = "https://apis.roblox.com";

interface QueueClientCredentials {
	apiKey: string;
	universeId: string;
}

interface QueueClientOptions {
	http?: HttpClient;
}

interface AddOptions {
	priority?: number;
	ttlSeconds: number;
}

interface ReadOptions {
	count: number;
	invisibilityWindowSeconds: number;
}

interface QueueReadResult<T> {
	id: string;
	items: Array<T>;
}

export class MemoryStoreQueueClient {
	private readonly baseUrl: string;
	private readonly credentials: QueueClientCredentials;
	private readonly http: HttpClient;

	constructor(credentials: QueueClientCredentials, options?: QueueClientOptions) {
		this.baseUrl = resolveOpenCloudBaseUrl();
		this.credentials = credentials;
		this.http = options?.http ?? createFetchClient({ "x-api-key": credentials.apiKey });
	}

	public async add(queue: string, value: unknown, options: AddOptions): Promise<void> {
		const response = await this.http.request("POST", this.queueUrl(queue, "/items"), {
			body: {
				data: value,
				expiration: `${options.ttlSeconds.toString()}s`,
				priority: options.priority ?? 0,
			},
		});

		if (!response.ok) {
			throw new Error(
				`Failed to add queue item: ${response.status.toString()} body=${JSON.stringify(response.body)}`,
			);
		}
	}

	public async discard(queue: string, readId: string): Promise<void> {
		const response = await this.http.request("POST", this.queueUrl(queue, "/items:discard"), {
			body: { readId },
		});

		if (!response.ok) {
			throw new Error(`Failed to discard queue items: ${response.status.toString()}`);
		}
	}

	public async read<T>(queue: string, options: ReadOptions): Promise<QueueReadResult<T>> {
		const response = await this.http.request("POST", this.queueUrl(queue, "/items:read"), {
			body: {
				count: options.count,
				invisibilityWindow: `${options.invisibilityWindowSeconds.toString()}s`,
			},
		});

		if (!response.ok) {
			throw new Error(`Failed to read queue items: ${response.status.toString()}`);
		}

		const body = response.body as { id: string; items?: Array<T> };
		return { id: body.id, items: body.items ?? [] };
	}

	private queueUrl(queue: string, suffix: string): string {
		return `${this.baseUrl}/cloud/v2/universes/${this.credentials.universeId}/memory-store/queues/${queue}${suffix}`;
	}
}

function resolveOpenCloudBaseUrl(): string {
	const override = process.env["JEST_ROBLOX_OPEN_CLOUD_BASE_URL"];
	if (override === undefined || override.trim() === "") {
		return DEFAULT_OPEN_CLOUD_BASE_URL;
	}

	return override.replace(/\/+$/, "");
}
