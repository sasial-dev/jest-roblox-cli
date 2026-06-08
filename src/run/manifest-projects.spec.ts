import { fromAny } from "@total-typescript/shoehorn";

import { describe, expect, it } from "vitest";

import type { ResolvedProjectConfig } from "../config/projects.ts";
import type { ResolvedConfig } from "../config/schema.ts";
import type { RojoTreeNode } from "../types/rojo.ts";
import { toBuildManifestProjects, toSingleProjectManifest } from "./manifest-projects.ts";

describe(toBuildManifestProjects, () => {
	it("should map a resolved project to one entry per DataModel mount", () => {
		expect.assertions(1);

		const projects: Array<ResolvedProjectConfig> = fromAny([
			{
				config: { jestPath: "RS/jest", setupFiles: ["RS/setup"], setupFilesAfterEnv: [] },
				displayName: "client",
				projects: ["ReplicatedStorage/client"],
				testMatch: ["**/*.spec"],
			},
		]);

		expect(toBuildManifestProjects(projects)).toStrictEqual([
			{
				displayName: "client",
				jestDataModelPath: "RS/jest",
				projectDataModelPath: "ReplicatedStorage/client",
				setupFiles: ["RS/setup"],
				setupFilesAfterEnv: [],
				testMatch: ["**/*.spec"],
			},
		]);
	});

	it("should emit one entry per mount, omitting jestDataModelPath and defaulting setup files", () => {
		expect.assertions(1);

		const projects: Array<ResolvedProjectConfig> = fromAny([
			{
				config: {},
				displayName: "shared",
				projects: ["ReplicatedStorage/a", "ServerScriptService/b"],
				testMatch: ["**/*.spec"],
			},
		]);

		expect(toBuildManifestProjects(projects)).toStrictEqual([
			{
				displayName: "shared",
				projectDataModelPath: "ReplicatedStorage/a",
				setupFiles: [],
				setupFilesAfterEnv: [],
				testMatch: ["**/*.spec"],
			},
			{
				displayName: "shared",
				projectDataModelPath: "ServerScriptService/b",
				setupFiles: [],
				setupFilesAfterEnv: [],
				testMatch: ["**/*.spec"],
			},
		]);
	});
});

describe(toSingleProjectManifest, () => {
	const tree: RojoTreeNode = fromAny({
		$className: "DataModel",
		ReplicatedStorage: { TS: { $path: "out" } },
	});

	it("should map each luau root to its DataModel mount", () => {
		expect.assertions(1);

		const config: ResolvedConfig = fromAny({
			jestPath: "RS/jest",
			rootDir: "/pkg",
			setupFiles: ["RS/setup"],
			setupFilesAfterEnv: [],
			testMatch: ["**/*.spec"],
		});

		expect(toSingleProjectManifest(config, ["out"], tree)).toStrictEqual([
			{
				displayName: "pkg",
				jestDataModelPath: "RS/jest",
				projectDataModelPath: "ReplicatedStorage/TS",
				setupFiles: ["RS/setup"],
				setupFilesAfterEnv: [],
				testMatch: ["**/*.spec"],
			},
		]);
	});

	it("should skip luau roots that do not map to the rojo tree", () => {
		expect.assertions(1);

		const config: ResolvedConfig = fromAny({ rootDir: "/pkg", testMatch: [] });

		expect(toSingleProjectManifest(config, ["does-not-exist"], tree)).toStrictEqual([]);
	});

	it("should derive displayName from a rootDir with a trailing separator", () => {
		expect.assertions(1);

		const config: ResolvedConfig = fromAny({ rootDir: "/pkg/", testMatch: ["**/*.spec"] });

		expect(toSingleProjectManifest(config, ["out"], tree)[0]!.displayName).toBe("pkg");
	});
});
