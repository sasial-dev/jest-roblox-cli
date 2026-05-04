import { fromAny } from "@total-typescript/shoehorn";

import { vol } from "memfs";
import * as path from "node:path";
import process from "node:process";
import { describe, expect, it, vi } from "vitest";

import type { Backend, BackendOptions, BackendResult } from "./backends/interface.ts";
import { DEFAULT_CONFIG, type ResolvedConfig } from "./config/schema.ts";
import { runWorkspace } from "./workspace-runner.ts";

vi.mock(import("node:fs"), async () => {
	const memfs = await vi.importActual<typeof import("memfs")>("memfs");
	return fromAny({ ...memfs.fs, default: memfs.fs });
});

vi.mock(import("./utils/rojo-builder.ts"));

const ROOT = path.resolve("/repo");
const FOO_DIR = path.join(ROOT, "packages/foo");
const BAR_DIR = path.join(ROOT, "packages/bar");
const BAZ_DIR = path.join(ROOT, "packages/baz");
const FOO_INFO = { name: "@halcyon/foo", packageDirectory: FOO_DIR };
const BAR_INFO = { name: "@halcyon/bar", packageDirectory: BAR_DIR };
const BAZ_INFO = { name: "@halcyon/baz", packageDirectory: BAZ_DIR };

function packageJson(json: object): string {
	return String(JSON.stringify(json));
}

function passingResult(): string {
	return JSON.stringify({
		numFailedTests: 0,
		numPassedTests: 1,
		numPendingTests: 0,
		numTotalTests: 1,
		startTime: 0,
		success: true,
		testResults: [],
	});
}

function failingResult(): string {
	return JSON.stringify({
		numFailedTests: 1,
		numPassedTests: 0,
		numPendingTests: 0,
		numTotalTests: 1,
		startTime: 0,
		success: false,
		testResults: [],
	});
}

function createStubBackend(envelope: string): Backend {
	return {
		kind: "open-cloud",
		runTests: async (_options: BackendOptions): Promise<BackendResult> => {
			const parsed = JSON.parse(envelope) as {
				entries: Array<{ jestOutput: string; pkg?: string }>;
			};
			return {
				results: parsed.entries.map((entry) => {
					return {
						displayName: entry.pkg ?? "",
						elapsedMs: 0,
						result: JSON.parse(entry.jestOutput) as never,
					};
				}),
				timing: { executionMs: 0, uploadMs: 0 },
			};
		},
	};
}

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
	return { ...DEFAULT_CONFIG, rootDir: FOO_DIR, ...overrides };
}

function seedSinglePackage(): void {
	vol.fromJSON({
		[path.join(FOO_DIR, "jest.config.ts")]: "export default {}",
		[path.join(FOO_DIR, "package.json")]: packageJson({ name: "@halcyon/foo" }),
		[path.join(FOO_DIR, "test.project.json")]: packageJson({
			name: "foo-test",
			tree: { $className: "DataModel" },
		}),
		[path.join(ROOT, "pnpm-workspace.yaml")]: "packages:\n  - packages/*\n",
	});
}

function seedThreePackages(): void {
	vol.fromJSON({
		[path.join(BAR_DIR, "package.json")]: packageJson({ name: "@halcyon/bar" }),
		[path.join(BAR_DIR, "test.project.json")]: packageJson({
			name: "bar-test",
			tree: { $className: "DataModel" },
		}),
		[path.join(BAZ_DIR, "package.json")]: packageJson({ name: "@halcyon/baz" }),
		[path.join(BAZ_DIR, "test.project.json")]: packageJson({
			name: "baz-test",
			tree: { $className: "DataModel" },
		}),
		[path.join(FOO_DIR, "package.json")]: packageJson({ name: "@halcyon/foo" }),
		[path.join(FOO_DIR, "test.project.json")]: packageJson({
			name: "foo-test",
			tree: { $className: "DataModel" },
		}),
		[path.join(ROOT, "pnpm-workspace.yaml")]: "packages:\n  - packages/*\n",
	});
}

describe(runWorkspace, () => {
	it("should return one ExecuteResult per package on success", async () => {
		expect.assertions(4);

		vol.reset();
		seedSinglePackage();

		const envelope = JSON.stringify({
			entries: [{ jestOutput: passingResult(), pkg: "@halcyon/foo" }],
		});

		const results = await runWorkspace({
			backend: createStubBackend(envelope),
			config: makeConfig(),
			packageInfos: [FOO_INFO],
			version: "0.0.0-test",
			workspaceRoot: ROOT,
		});

		expect(results).toHaveLength(1);
		expect(results?.[0]?.displayName).toBe("@halcyon/foo");
		expect(results?.[0]?.result.exitCode).toBe(0);
		expect(results?.[0]?.result.result.success).toBeTrue();
	});

	it("should mark exit code 1 for the package whose envelope entry failed", async () => {
		expect.assertions(1);

		vol.reset();
		seedSinglePackage();

		const envelope = JSON.stringify({
			entries: [{ jestOutput: failingResult(), pkg: "@halcyon/foo" }],
		});

		const results = await runWorkspace({
			backend: createStubBackend(envelope),
			config: makeConfig(),
			packageInfos: [FOO_INFO],
			version: "0.0.0-test",
			workspaceRoot: ROOT,
		});

		expect(results?.[0]?.result.exitCode).toBe(1);
	});

	it("should return per-package results for three packages in input order", async () => {
		expect.assertions(4);

		vol.reset();
		seedThreePackages();

		const envelope = JSON.stringify({
			entries: [
				{ jestOutput: passingResult(), pkg: "@halcyon/foo" },
				{ jestOutput: failingResult(), pkg: "@halcyon/bar" },
				{ jestOutput: passingResult(), pkg: "@halcyon/baz" },
			],
		});

		const results = await runWorkspace({
			backend: createStubBackend(envelope),
			config: makeConfig(),
			packageInfos: [FOO_INFO, BAR_INFO, BAZ_INFO],
			version: "0.0.0-test",
			workspaceRoot: ROOT,
		});

		expect(results?.map((entry) => entry.displayName)).toStrictEqual([
			"@halcyon/foo",
			"@halcyon/bar",
			"@halcyon/baz",
		]);
		expect(results?.[0]?.result.exitCode).toBe(0);
		expect(results?.[1]?.result.exitCode).toBe(1);
		expect(results?.[2]?.result.exitCode).toBe(0);
	});

	it("should send a single backend request that materializes all packages", async () => {
		expect.assertions(2);

		vol.reset();
		seedThreePackages();

		const envelope = JSON.stringify({
			entries: [
				{ jestOutput: passingResult(), pkg: "@halcyon/foo" },
				{ jestOutput: passingResult(), pkg: "@halcyon/bar" },
				{ jestOutput: passingResult(), pkg: "@halcyon/baz" },
			],
		});

		let captured: BackendOptions | undefined;
		const backend: Backend = {
			kind: "open-cloud",
			runTests: async (options) => {
				captured = options;
				const parsed = JSON.parse(envelope) as {
					entries: Array<{ jestOutput: string; pkg?: string }>;
				};
				return {
					results: parsed.entries.map((entry) => {
						return {
							displayName: entry.pkg ?? "",
							elapsedMs: 0,
							result: JSON.parse(entry.jestOutput) as never,
						};
					}),
					timing: { executionMs: 0, uploadMs: 0 },
				};
			},
		};

		await runWorkspace({
			backend,
			config: makeConfig(),
			packageInfos: [FOO_INFO, BAR_INFO, BAZ_INFO],
			version: "0.0.0-test",
			workspaceRoot: ROOT,
		});

		expect(captured?.scriptOverride).toContain('"pkg":"@halcyon/foo"');
		expect(captured?.scriptOverride).toContain('"pkg":"@halcyon/baz"');
	});

	it("should auto-create missing $path directories and succeed", async () => {
		expect.assertions(3);

		vol.reset();
		vol.fromJSON({
			[path.join(FOO_DIR, "package.json")]: packageJson({ name: "@halcyon/foo" }),
			[path.join(FOO_DIR, "test.project.json")]: packageJson({
				name: "foo-test",
				tree: {
					$className: "DataModel",
					ReplicatedStorage: { $path: "src/Components" },
				},
			}),
			[path.join(ROOT, "pnpm-workspace.yaml")]: "packages:\n  - packages/*\n",
		});

		const envelope = JSON.stringify({
			entries: [{ jestOutput: passingResult(), pkg: "@halcyon/foo" }],
		});

		const results = await runWorkspace({
			backend: createStubBackend(envelope),
			config: makeConfig(),
			packageInfos: [FOO_INFO],
			version: "0.0.0-test",
			workspaceRoot: ROOT,
		});

		expect(results).toHaveLength(1);
		expect(results?.[0]?.result.exitCode).toBe(0);
		expect(vol.existsSync(path.join(FOO_DIR, "src/Components"))).toBeTrue();
	});

	it("should still fail preflight when $path looks like a missing file", async () => {
		expect.assertions(2);

		vol.reset();
		const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

		vol.fromJSON({
			[path.join(FOO_DIR, "package.json")]: packageJson({ name: "@halcyon/foo" }),
			[path.join(FOO_DIR, "test.project.json")]: packageJson({
				name: "foo-test",
				tree: {
					$className: "DataModel",
					ReplicatedStorage: { Module: { $path: "src/missing.luau" } },
				},
			}),
			[path.join(ROOT, "pnpm-workspace.yaml")]: "packages:\n  - packages/*\n",
		});

		const results = await runWorkspace({
			backend: createStubBackend(""),
			config: makeConfig(),
			packageInfos: [FOO_INFO],
			version: "0.0.0-test",
			workspaceRoot: ROOT,
		});

		expect(results).toBeUndefined();
		expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/missing\.luau/));
	});

	it("should auto-create $path directories that have child entries even with extension", async () => {
		expect.assertions(2);

		vol.reset();
		vol.fromJSON({
			[path.join(FOO_DIR, "package.json")]: packageJson({ name: "@halcyon/foo" }),
			[path.join(FOO_DIR, "test.project.json")]: packageJson({
				name: "foo-test",
				tree: {
					$className: "DataModel",
					ReplicatedStorage: {
						Container: {
							$path: "src/has.dot",
							Inner: { $className: "Folder" },
						},
					},
				},
			}),
			[path.join(ROOT, "pnpm-workspace.yaml")]: "packages:\n  - packages/*\n",
		});

		const envelope = JSON.stringify({
			entries: [{ jestOutput: passingResult(), pkg: "@halcyon/foo" }],
		});

		const results = await runWorkspace({
			backend: createStubBackend(envelope),
			config: makeConfig(),
			packageInfos: [FOO_INFO],
			version: "0.0.0-test",
			workspaceRoot: ROOT,
		});

		expect(results?.[0]?.result.exitCode).toBe(0);
		expect(vol.existsSync(path.join(FOO_DIR, "src/has.dot"))).toBeTrue();
	});

	it("should leave existing $path directories untouched", async () => {
		expect.assertions(2);

		vol.reset();
		vol.fromJSON({
			[path.join(FOO_DIR, "package.json")]: packageJson({ name: "@halcyon/foo" }),
			[path.join(FOO_DIR, "src/Existing/keep.luau")]: "return {}",
			[path.join(FOO_DIR, "test.project.json")]: packageJson({
				name: "foo-test",
				tree: {
					$className: "DataModel",
					ReplicatedStorage: { $path: "src/Existing" },
				},
			}),
			[path.join(ROOT, "pnpm-workspace.yaml")]: "packages:\n  - packages/*\n",
		});

		const envelope = JSON.stringify({
			entries: [{ jestOutput: passingResult(), pkg: "@halcyon/foo" }],
		});

		const results = await runWorkspace({
			backend: createStubBackend(envelope),
			config: makeConfig(),
			packageInfos: [FOO_INFO],
			version: "0.0.0-test",
			workspaceRoot: ROOT,
		});

		expect(results?.[0]?.result.exitCode).toBe(0);
		expect(vol.existsSync(path.join(FOO_DIR, "src/Existing/keep.luau"))).toBeTrue();
	});

	it("should defer malformed rojo project to preflight error reporting", async () => {
		expect.assertions(2);

		vol.reset();
		const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

		vol.fromJSON({
			[path.join(FOO_DIR, "package.json")]: packageJson({ name: "@halcyon/foo" }),
			[path.join(FOO_DIR, "test.project.json")]: "not valid json {{",
			[path.join(ROOT, "pnpm-workspace.yaml")]: "packages:\n  - packages/*\n",
		});

		const results = await runWorkspace({
			backend: createStubBackend(""),
			config: makeConfig(),
			packageInfos: [FOO_INFO],
			version: "0.0.0-test",
			workspaceRoot: ROOT,
		});

		expect(results).toBeUndefined();
		expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/failed to parse rojoProject/));
	});

	it("should return undefined and surface every preflight failure when any package is invalid", async () => {
		expect.assertions(3);

		vol.reset();
		const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

		vol.fromJSON({
			[path.join(BAR_DIR, "package.json")]: packageJson({ name: "@halcyon/bar" }),
			// no test.project.json for bar — preflight fails for bar
			[path.join(BAZ_DIR, "package.json")]: packageJson({ name: "@halcyon/baz" }),
			// no test.project.json for baz — preflight fails for baz
			[path.join(FOO_DIR, "package.json")]: packageJson({ name: "@halcyon/foo" }),
			[path.join(FOO_DIR, "test.project.json")]: packageJson({
				name: "foo-test",
				tree: { $className: "DataModel" },
			}),
			[path.join(ROOT, "pnpm-workspace.yaml")]: "packages:\n  - packages/*\n",
		});

		const results = await runWorkspace({
			backend: createStubBackend(""),
			config: makeConfig(),
			packageInfos: [FOO_INFO, BAR_INFO, BAZ_INFO],
			version: "0.0.0-test",
			workspaceRoot: ROOT,
		});

		expect(results).toBeUndefined();
		expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/@halcyon\/bar/));
		expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/@halcyon\/baz/));
	});
});
