import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { startFakeOpenCloudServer } from "./fake-open-cloud.ts";
import { createFixtureSandbox, runCliAsync } from "./helpers.ts";

const RBXTS_FIXTURE = path.resolve(__dirname, "fixtures/rbxts-project");

const PASSING_PAYLOAD = {
	_setup: 0.1,
	success: true,
	value: {
		numFailedTests: 0,
		numPassedTests: 1,
		numPendingTests: 0,
		numTotalTests: 1,
		startTime: 1_710_000_000_000,
		success: true,
		testResults: [
			{
				numFailingTests: 0,
				numPassingTests: 1,
				numPendingTests: 0,
				testFilePath: "ReplicatedStorage/shared/example.spec",
				testResults: [
					{
						ancestorTitles: ["example"],
						duration: 12,
						failureMessages: [],
						fullName: "example greets",
						status: "passed",
						title: "greets",
					},
				],
			},
		],
	},
};

function buildMixedOutput(payload: Record<string, unknown>): string {
	return [
		"Booting fake Roblox runner",
		JSON.stringify(payload),
		"Finished fake Roblox runner",
	].join("\n");
}

function writeConfigWithCredentials(
	sandbox: string,
	credentials: { placeId: string; universeId: string },
): void {
	writeFileSync(
		path.join(sandbox, "jest.config.ts"),
		`import { defineConfig } from "@isentinel/jest-roblox";

export default defineConfig({
	placeId: "${credentials.placeId}",
	rojoProject: "default.project.json",
	test: {
		projects: [
			{
				test: {
					displayName: "rbxts-e2e",
					include: ["src/**/*.spec.ts"],
					outDir: "out",
				},
			},
		],
	},
	universeId: "${credentials.universeId}",
});
`,
	);
}

describe("credential sources (open-cloud)", () => {
	it("should pass credentials through end-to-end when provided via CLI flags", async () => {
		expect.assertions(5);

		const sandbox = createFixtureSandbox(RBXTS_FIXTURE);
		const server = await startFakeOpenCloudServer([
			{ jestOutput: buildMixedOutput(PASSING_PAYLOAD) },
		]);

		const result = await runCliAsync(
			[
				"--backend",
				"open-cloud",
				"--no-cache",
				"--apiKey",
				"cli-key",
				"--universeId",
				"4242",
				"--placeId",
				"9999",
			],
			{
				cwd: sandbox,
				env: { JEST_ROBLOX_OPEN_CLOUD_BASE_URL: server.baseUrl },
			},
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("1 passed");

		const apiKeys = new Set(server.calls.map((call) => call.apiKey));

		expect(apiKeys).toStrictEqual(new Set(["cli-key"]));

		const uploadCall = server.calls.find((call) => call.url.includes("/versions"));

		expect(uploadCall?.url).toContain("/universes/v1/4242/places/9999/versions");

		const taskCall = server.calls.find((call) =>
			call.url.includes("/luau-execution-session-tasks"),
		);

		expect(taskCall?.url).toContain("/universes/4242/places/9999/luau-execution-session-tasks");
	});

	it("should resolve universeId/placeId from jest.config.ts and apiKey from CLI", async () => {
		expect.assertions(3);

		const sandbox = createFixtureSandbox(RBXTS_FIXTURE);
		writeConfigWithCredentials(sandbox, { placeId: "777", universeId: "555" });

		const server = await startFakeOpenCloudServer([
			{ jestOutput: buildMixedOutput(PASSING_PAYLOAD) },
		]);

		const result = await runCliAsync(
			["--backend", "open-cloud", "--no-cache", "--apiKey", "cli-key"],
			{
				cwd: sandbox,
				env: { JEST_ROBLOX_OPEN_CLOUD_BASE_URL: server.baseUrl },
			},
		);

		expect(result.exitCode).toBe(0);

		const uploadCall = server.calls.find((call) => call.url.includes("/versions"));

		expect(uploadCall?.url).toContain("/universes/v1/555/places/777/versions");
		expect(uploadCall?.apiKey).toBe("cli-key");
	});

	it("should let CLI flags override jest.config.ts values", async () => {
		expect.assertions(2);

		const sandbox = createFixtureSandbox(RBXTS_FIXTURE);
		writeConfigWithCredentials(sandbox, {
			placeId: "config-place",
			universeId: "config-universe",
		});

		const server = await startFakeOpenCloudServer([
			{ jestOutput: buildMixedOutput(PASSING_PAYLOAD) },
		]);

		const result = await runCliAsync(
			[
				"--backend",
				"open-cloud",
				"--no-cache",
				"--apiKey",
				"cli-key",
				"--universeId",
				"override-universe",
				"--placeId",
				"override-place",
			],
			{
				cwd: sandbox,
				env: { JEST_ROBLOX_OPEN_CLOUD_BASE_URL: server.baseUrl },
			},
		);

		expect(result.exitCode).toBe(0);

		const uploadCall = server.calls.find((call) => call.url.includes("/versions"));

		expect(uploadCall?.url).toContain(
			"/universes/v1/override-universe/places/override-place/versions",
		);
	});

	it("should report missing fields when CLI overrides are partial and no other source supplies them", async () => {
		expect.assertions(3);

		const sandbox = createFixtureSandbox(RBXTS_FIXTURE);

		const result = await runCliAsync(
			["--backend", "open-cloud", "--no-cache", "--apiKey", "cli-key"],
			{ cwd: sandbox },
		);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("Missing: universeId, placeId");
		expect(result.stderr).toContain(
			"Set ROBLOX_UNIVERSE_ID (or JEST_ROBLOX_UNIVERSE_ID), ROBLOX_PLACE_ID (or JEST_ROBLOX_PLACE_ID)",
		);
	});
});
