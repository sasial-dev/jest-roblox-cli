import { fromAny } from "@total-typescript/shoehorn";

import { describe, expect, it, vi } from "vitest";

import { resolveAllProjects } from "../config/projects.ts";
import { DEFAULT_CONFIG, type ResolvedConfig } from "../config/schema.ts";
import type { CoverageArtifacts } from "../coverage/build-manifest.ts";
import { emitBuildManifest } from "../coverage/build-manifest.ts";
import { COVERAGE_BUILD_MANIFEST_PATH, COVERAGE_MANIFEST_PATH } from "../coverage/prepare.ts";
import { getRawProjects, runSingleOrMulti } from "../run.ts";
import { collectStubMounts, loadRojoTree } from "../run/multi.ts";
import type { MultiRunResult, SingleRunResult } from "../run/types.ts";
import { buildPlace } from "../staging/place-builder.ts";
import { prepareArtifacts } from "./prepare-artifacts.ts";

vi.mock(import("../run.ts"));
vi.mock(import("../run/multi.ts"));
vi.mock(import("../staging/place-builder.ts"));
vi.mock(import("../config/projects.ts"));
vi.mock(import("../coverage/build-manifest.ts"));
vi.mock(import("../coverage/prepare.ts"), () => {
	return {
		COVERAGE_BUILD_MANIFEST_PATH: ".jest-roblox/coverage/build-manifest.json",
		COVERAGE_MANIFEST_PATH: ".jest-roblox/coverage/coverage-manifest.json",
		findRojoProject: vi.fn<() => string>(() => "/test/default.project.json"),
	};
});

const mocks = {
	buildPlace: vi.mocked(buildPlace),
	collectStubMounts: vi.mocked(collectStubMounts),
	emitBuildManifest: vi.mocked(emitBuildManifest),
	getRawProjects: vi.mocked(getRawProjects),
	loadRojoTree: vi.mocked(loadRojoTree),
	resolveAllProjects: vi.mocked(resolveAllProjects),
	runSingleOrMulti: vi.mocked(runSingleOrMulti),
};

const COVERAGE_PLACE = { hash: "cov-hash", path: ".jest-roblox/coverage/game.rbxl" };
const CLEAN_PLACE = { hash: "clean-hash", path: ".jest-roblox/coverage/clean.rbxl" };

function makeArtifacts(overrides: Partial<CoverageArtifacts> = {}): CoverageArtifacts {
	return {
		buildId: "build-42",
		coveragePlace: COVERAGE_PLACE,
		files: { "out/init.luau": { sourceHash: "h" } },
		generatedAt: "2026-06-07T00:00:00.000Z",
		projects: [],
		rebuilt: true,
		...overrides,
	};
}

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
	return {
		...DEFAULT_CONFIG,
		rootDir: "/test",
		testMatch: ["**/*.spec.ts"],
		testPathIgnorePatterns: [],
		...overrides,
	};
}

function singleResult(overrides: Partial<SingleRunResult> = {}): SingleRunResult {
	return { mode: "single", preCoverageMs: 0, ...overrides };
}

function multiResult(overrides: Partial<MultiRunResult> = {}): MultiRunResult {
	return { merged: {}, mode: "multi", preCoverageMs: 0, projectResults: [], ...overrides };
}

describe(prepareArtifacts, () => {
	it("should return distinct clean and coverage places sharing one buildId", async () => {
		expect.assertions(4);

		mocks.runSingleOrMulti.mockResolvedValue(
			singleResult({ coverageArtifacts: makeArtifacts() }),
		);
		mocks.buildPlace.mockReturnValue(CLEAN_PLACE);

		const bundle = await prepareArtifacts(makeConfig());

		expect(bundle.coveragePlace).toStrictEqual(COVERAGE_PLACE);
		expect(bundle.cleanPlace).toStrictEqual(CLEAN_PLACE);
		expect(bundle.cleanPlace.hash).not.toBe(bundle.coveragePlace.hash);
		expect(bundle.buildId).toBe("build-42");
	});

	it("should surface the coverage manifest paths and an empty projects list", async () => {
		expect.assertions(3);

		mocks.runSingleOrMulti.mockResolvedValue(
			singleResult({ coverageArtifacts: makeArtifacts() }),
		);
		mocks.buildPlace.mockReturnValue(CLEAN_PLACE);

		const bundle = await prepareArtifacts(makeConfig());

		expect(bundle.buildManifestPath).toBe(COVERAGE_BUILD_MANIFEST_PATH);
		expect(bundle.coverageManifestPath).toBe(COVERAGE_MANIFEST_PATH);
		expect(bundle.projects).toStrictEqual([]);
	});

	it("should surface the resolved projects from the coverage artifacts", async () => {
		expect.assertions(1);

		const project = {
			displayName: "client",
			projectDataModelPath: "ReplicatedStorage/client",
			setupFiles: [],
			setupFilesAfterEnv: [],
			testMatch: ["**/*.spec"],
		};
		mocks.runSingleOrMulti.mockResolvedValue(
			singleResult({ coverageArtifacts: makeArtifacts({ projects: [project] }) }),
		);
		mocks.buildPlace.mockReturnValue(CLEAN_PLACE);

		const bundle = await prepareArtifacts(makeConfig());

		expect(bundle.projects).toStrictEqual([project]);
	});

	it("should emit the build manifest once with both places", async () => {
		expect.assertions(1);

		const artifacts = makeArtifacts();
		mocks.runSingleOrMulti.mockResolvedValue(singleResult({ coverageArtifacts: artifacts }));
		mocks.buildPlace.mockReturnValue(CLEAN_PLACE);

		await prepareArtifacts(makeConfig());

		expect(mocks.emitBuildManifest).toHaveBeenCalledWith(
			COVERAGE_BUILD_MANIFEST_PATH,
			artifacts,
			CLEAN_PLACE,
		);
	});

	it("should carry coverage data from a single run", async () => {
		expect.assertions(1);

		mocks.runSingleOrMulti.mockResolvedValue(
			singleResult({
				coverageArtifacts: makeArtifacts(),
				runtimeResult: fromAnyRuntime({ "a.luau": { s: { "0": 1 } } }),
			}),
		);
		mocks.buildPlace.mockReturnValue(CLEAN_PLACE);

		const bundle = await prepareArtifacts(makeConfig());

		expect(bundle.coverageData).toStrictEqual({ "a.luau": { s: { "0": 1 } } });
	});

	it("should build the clean place without stub mounts in single mode", async () => {
		expect.assertions(2);

		mocks.runSingleOrMulti.mockResolvedValue(
			singleResult({ coverageArtifacts: makeArtifacts() }),
		);
		mocks.buildPlace.mockReturnValue(CLEAN_PLACE);

		await prepareArtifacts(makeConfig());

		expect(mocks.resolveAllProjects).not.toHaveBeenCalled();
		expect(mocks.buildPlace.mock.calls[0]![0].packages[0]!.stubMounts).toBeUndefined();
	});

	it("should build the clean place with stub mounts in multi mode", async () => {
		expect.assertions(2);

		const config = makeConfig();
		const projects = [{ test: { displayName: "c" } }];
		(config as unknown as { projects: Array<unknown> }).projects = projects;
		// run.ts is mocked, so `getRawProjects` (its export) is too — feed the
		// multi-mode branch its real passthrough.
		mocks.getRawProjects.mockReturnValue(fromAny(projects));
		mocks.runSingleOrMulti.mockResolvedValue(
			multiResult({
				coverageArtifacts: makeArtifacts(),
				merged: { coverageData: { "b.luau": { s: { "0": 1 } } } },
			}),
		);
		mocks.loadRojoTree.mockReturnValue({ $className: "DataModel" });
		mocks.resolveAllProjects.mockResolvedValue([]);
		mocks.collectStubMounts.mockReturnValue([
			{
				absStubPath: "/test/.jest-roblox/cache/out/jest.config.luau",
				dataModelPath: "game.X",
			},
		]);
		mocks.buildPlace.mockReturnValue(CLEAN_PLACE);

		const bundle = await prepareArtifacts(config);

		expect(mocks.buildPlace.mock.calls[0]![0].packages[0]!.stubMounts).toHaveLength(1);
		expect(bundle.coverageData).toStrictEqual({ "b.luau": { s: { "0": 1 } } });
	});

	it("should throw when the coverage run produced no artifacts", async () => {
		expect.assertions(1);

		mocks.runSingleOrMulti.mockResolvedValue(singleResult());

		await expect(prepareArtifacts(makeConfig())).rejects.toThrow(/no artifacts/);
	});
});

function fromAnyRuntime(coverageData: Record<string, unknown>): SingleRunResult["runtimeResult"] {
	return { coverageData } as unknown as SingleRunResult["runtimeResult"];
}
