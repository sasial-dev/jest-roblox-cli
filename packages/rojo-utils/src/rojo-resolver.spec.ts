import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
	FileRelation,
	NetworkType,
	RbxPathParent,
	RbxType,
	RojoResolver,
} from "./rojo-resolver.ts";

type FileMap = Record<string, string>;

function withProject(files: FileMap, run: (directory: string) => void): void {
	const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "rojo-resolver-")));
	try {
		for (const [relativePath, content] of Object.entries(files)) {
			const full = path.join(directory, relativePath);
			mkdirSync(path.dirname(full), { recursive: true });
			writeFileSync(full, content);
		}

		run(directory);
	} finally {
		rmSync(directory, { force: true, recursive: true });
	}
}

function project(tree: object, name = "Game"): string {
	return JSON.stringify({ name, tree });
}

function fromProject(directory: string): RojoResolver {
	return RojoResolver.fromPath(path.join(directory, "default.project.json"));
}

describe("findRojoConfigFilePath", () => {
	it("should return the default project file when present", () => {
		expect.assertions(2);

		withProject(
			{ "default.project.json": project({ $className: "DataModel" }) },
			(directory) => {
				const result = RojoResolver.findRojoConfigFilePath(directory);

				expect(result.path).toBe(path.join(directory, "default.project.json"));
				expect(result.warnings).toBeEmpty();
			},
		);
	});

	it("should return a single non-default project file without warning", () => {
		expect.assertions(2);

		withProject({ "game.project.json": project({ $className: "DataModel" }) }, (directory) => {
			const result = RojoResolver.findRojoConfigFilePath(directory);

			expect(result.path).toBe(path.join(directory, "game.project.json"));
			expect(result.warnings).toBeEmpty();
		});
	});

	it("should recognize the legacy roblox-project.json name", () => {
		expect.assertions(1);

		withProject(
			{ "roblox-project.json": project({ $className: "DataModel" }) },
			(directory) => {
				expect(RojoResolver.findRojoConfigFilePath(directory).path).toBe(
					path.join(directory, "roblox-project.json"),
				);
			},
		);
	});

	it("should warn when multiple project files are present", () => {
		expect.assertions(1);

		withProject(
			{
				"a.project.json": project({ $className: "DataModel" }),
				"b.project.json": project({ $className: "DataModel" }),
			},
			(directory) => {
				expect(RojoResolver.findRojoConfigFilePath(directory).warnings[0]).toInclude(
					"Multiple *.project.json files found",
				);
			},
		);
	});

	it("should return undefined when no project file is present", () => {
		expect.assertions(1);

		withProject({ "readme.md": "hi" }, (directory) => {
			expect(RojoResolver.findRojoConfigFilePath(directory).path).toBeUndefined();
		});
	});
});

describe("fromPath", () => {
	it("should mark a DataModel project as a game", () => {
		expect.assertions(1);

		withProject(
			{ "default.project.json": project({ $className: "DataModel" }) },
			(directory) => {
				expect(fromProject(directory).isGame).toBeTrue();
			},
		);
	});

	it("should warn when the config path does not exist", () => {
		expect.assertions(1);

		withProject({ "readme.md": "hi" }, (directory) => {
			const resolver = RojoResolver.fromPath(path.join(directory, "default.project.json"));

			expect(resolver.getWarnings()[0]).toInclude("Path does not exist");
		});
	});

	it("should warn on an invalid configuration", () => {
		expect.assertions(1);

		withProject({ "default.project.json": JSON.stringify({ notName: 1 }) }, (directory) => {
			expect(fromProject(directory).getWarnings()[0]).toInclude("Invalid configuration");
		});
	});

	it("should warn on malformed JSON instead of throwing", () => {
		expect.assertions(1);

		withProject({ "default.project.json": "{ broken json" }, (directory) => {
			expect(fromProject(directory).getWarnings()[0]).toInclude("Invalid configuration");
		});
	});

	it("should map a module file path directly", () => {
		expect.assertions(1);

		withProject(
			{
				"config.luau": "return {}",
				"default.project.json": project({
					$className: "DataModel",
					Config: { $path: "config.luau" },
				}),
			},
			(directory) => {
				expect(
					fromProject(directory).getRbxPathFromFilePath(
						path.join(directory, "config.luau"),
					),
				).toStrictEqual(["Config"]);
			},
		);
	});

	it("should resolve a directory partition and strip init", () => {
		expect.assertions(2);

		withProject(
			{
				"default.project.json": project({
					$className: "DataModel",
					ReplicatedStorage: { $path: "src/shared" },
				}),
				"src/shared/init.luau": "return {}",
				"src/shared/module.luau": "return {}",
			},
			(directory) => {
				const resolver = fromProject(directory);

				expect(
					resolver.getRbxPathFromFilePath(path.join(directory, "src/shared/init.luau")),
				).toStrictEqual(["ReplicatedStorage"]);
				expect(
					resolver.getRbxPathFromFilePath(path.join(directory, "src/shared/module.luau")),
				).toStrictEqual(["ReplicatedStorage", "module"]);
			},
		);
	});

	it("should accept the optional $path object form", () => {
		expect.assertions(1);

		withProject(
			{
				"default.project.json": project({
					$className: "DataModel",
					Maybe: { $path: { optional: "src/maybe" } },
				}),
				"src/maybe/value.luau": "return {}",
			},
			(directory) => {
				expect(
					fromProject(directory).getRbxPathFromFilePath(
						path.join(directory, "src/maybe/value.luau"),
					),
				).toStrictEqual(["Maybe", "value"]);
			},
		);
	});

	it("should create a partition for a $path that does not exist", () => {
		expect.assertions(1);

		withProject(
			{
				"default.project.json": project({
					$className: "DataModel",
					Ghost: { $path: "does/not/exist" },
				}),
			},
			(directory) => {
				expect(fromProject(directory).getPartitions()).not.toBeEmpty();
			},
		);
	});

	it("should parse a nested default project referenced by directory", () => {
		expect.assertions(1);

		withProject(
			{
				"default.project.json": project({
					$className: "DataModel",
					Nested: { $path: "nested" },
				}),
				"nested/default.project.json": project({ $path: "src" }, "Nested"),
				"nested/src/inside.luau": "return {}",
			},
			(directory) => {
				expect(
					fromProject(directory).getRbxPathFromFilePath(
						path.join(directory, "nested/src/inside.luau"),
					),
				).toStrictEqual(["Nested", "inside"]);
			},
		);
	});

	it("should return undefined for an unmapped file", () => {
		expect.assertions(1);

		withProject(
			{ "default.project.json": project({ $className: "DataModel" }) },
			(directory) => {
				expect(
					fromProject(directory).getRbxPathFromFilePath(
						path.join(directory, "elsewhere.luau"),
					),
				).toBeUndefined();
			},
		);
	});
});

describe("searchDirectory", () => {
	it("should follow nested project files and subfolders", () => {
		expect.assertions(2);

		withProject(
			{
				"default.project.json": project({
					$className: "DataModel",
					ReplicatedStorage: { $path: "src/shared" },
				}),
				"extra/leaf.luau": "return {}",
				"src/shared/extra.project.json": project({ $path: "../../extra" }, "Extra"),
				"src/shared/sub/leaf.luau": "return {}",
			},
			(directory) => {
				const resolver = fromProject(directory);

				expect(
					resolver.getRbxPathFromFilePath(
						path.join(directory, "src/shared/sub/leaf.luau"),
					),
				).toStrictEqual(["ReplicatedStorage", "sub", "leaf"]);
				expect(resolver.getPartitions().length).toBeGreaterThan(1);
			},
		);
	});

	it("should stop at a subfolder that has its own default project", () => {
		expect.assertions(1);

		withProject(
			{
				"default.project.json": project({
					$className: "DataModel",
					ReplicatedStorage: { $path: "src/shared" },
				}),
				"src/shared/module.luau": "return {}",
				"src/shared/withDefault/default.project.json": project(
					{ $path: "../module.luau" },
					"Inner",
				),
			},
			(directory) => {
				expect(fromProject(directory).isGame).toBeTrue();
			},
		);
	});
});

describe("getRbxTypeFromFilePath", () => {
	const resolver = RojoResolver.synthetic(".");

	it("should classify a .server script", () => {
		expect.assertions(1);
		expect(resolver.getRbxTypeFromFilePath("a.server.luau")).toBe(RbxType.Script);
	});

	it("should classify a .client script", () => {
		expect.assertions(1);
		expect(resolver.getRbxTypeFromFilePath("a.client.luau")).toBe(RbxType.LocalScript);
	});

	it("should classify a plain module script", () => {
		expect.assertions(1);
		expect(resolver.getRbxTypeFromFilePath("a.luau")).toBe(RbxType.ModuleScript);
	});

	it("should classify a non-script module by extension", () => {
		expect.assertions(1);
		expect(resolver.getRbxTypeFromFilePath("a.json")).toBe(RbxType.ModuleScript);
	});

	it("should return Unknown for an unrecognized sub-extension", () => {
		expect.assertions(1);
		expect(resolver.getRbxTypeFromFilePath("a.weird.luau")).toBe(RbxType.Unknown);
	});

	it("should convert a .lua extension to .luau", () => {
		expect.assertions(1);
		expect(resolver.getRbxTypeFromFilePath("a.lua")).toBe(RbxType.ModuleScript);
	});
});

describe("container queries", () => {
	function gameResolver(directory: string): RojoResolver {
		writeFileSync(
			path.join(directory, "default.project.json"),
			project({
				$className: "DataModel",
				ServerScriptService: { $path: "src/server" },
				StarterGui: { $path: "src/gui" },
				StarterPack: { $path: "src/pack" },
			}),
		);
		for (const relativePath of ["src/server/a.luau", "src/gui/b.luau", "src/pack/c.luau"]) {
			const full = path.join(directory, relativePath);
			mkdirSync(path.dirname(full), { recursive: true });
			writeFileSync(full, "return {}");
		}

		return fromProject(directory);
	}

	it("should report network type by container", () => {
		expect.assertions(3);

		withProject({}, (directory) => {
			const resolver = gameResolver(directory);

			expect(resolver.getNetworkType(["ServerScriptService"])).toBe(NetworkType.Server);
			expect(resolver.getNetworkType(["StarterGui"])).toBe(NetworkType.Client);
			expect(resolver.getNetworkType(["ReplicatedStorage"])).toBe(NetworkType.Unknown);
		});
	});

	it("should detect isolated containers", () => {
		expect.assertions(2);

		withProject({}, (directory) => {
			const resolver = gameResolver(directory);

			expect(resolver.isIsolated(["StarterGui"])).toBeTrue();
			expect(resolver.isIsolated(["ReplicatedStorage"])).toBeFalse();
		});
	});

	it("should compute file relations across containers", () => {
		expect.assertions(5);

		withProject({}, (directory) => {
			const resolver = gameResolver(directory);

			expect(resolver.getFileRelation(["StarterGui", "a"], ["StarterGui", "b"])).toBe(
				FileRelation.InToIn,
			);
			expect(resolver.getFileRelation(["StarterGui"], ["StarterPack"])).toBe(
				FileRelation.OutToIn,
			);
			expect(resolver.getFileRelation(["StarterGui"], ["ReplicatedStorage"])).toBe(
				FileRelation.InToOut,
			);
			expect(resolver.getFileRelation(["ReplicatedStorage"], ["StarterGui"])).toBe(
				FileRelation.OutToIn,
			);
			expect(resolver.getFileRelation(["ReplicatedStorage"], ["Workspace"])).toBe(
				FileRelation.OutToOut,
			);
		});
	});

	it("should treat a synthetic non-game resolver as all-out", () => {
		expect.assertions(3);

		const resolver = RojoResolver.synthetic(".");

		expect(resolver.getNetworkType(["StarterGui"])).toBe(NetworkType.Unknown);
		expect(resolver.isIsolated(["StarterGui"])).toBeFalse();
		expect(resolver.getFileRelation(["StarterGui"], ["StarterGui"])).toBe(
			FileRelation.OutToOut,
		);
	});
});

describe("relative", () => {
	it("should return an empty path for identical locations", () => {
		expect.assertions(1);
		expect(RojoResolver.relative(["a", "b"], ["a", "b"])).toBeEmpty();
	});

	it("should descend into a child path", () => {
		expect.assertions(1);
		expect(RojoResolver.relative(["a"], ["a", "b", "c"])).toStrictEqual(["b", "c"]);
	});

	it("should ascend with parent markers", () => {
		expect.assertions(1);
		expect(RojoResolver.relative(["a", "b", "c"], ["a"])).toStrictEqual([
			RbxPathParent,
			RbxPathParent,
		]);
	});

	it("should mix ascent and descent", () => {
		expect.assertions(1);
		expect(RojoResolver.relative(["a", "b"], ["a", "c"])).toStrictEqual([RbxPathParent, "c"]);
	});
});

describe("state serialization", () => {
	it("should round-trip through getState and fromState", () => {
		expect.assertions(4);

		withProject(
			{
				"default.project.json": project({
					$className: "DataModel",
					ReplicatedStorage: { $path: "src/shared" },
				}),
				"src/shared/module.luau": "return {}",
			},
			(directory) => {
				const original = fromProject(directory);
				const restored = RojoResolver.fromState(original.getState());
				const modulePath = path.join(directory, "src/shared/module.luau");

				expect(restored.isGame).toBe(original.isGame);
				expect(restored.getRbxPathFromFilePath(modulePath)).toStrictEqual(
					original.getRbxPathFromFilePath(modulePath),
				);
				expect(restored.walkedConfigFiles.size).toBe(original.walkedConfigFiles.size);
				expect(restored.walkedDirectories.size).toBe(original.walkedDirectories.size);
			},
		);
	});

	it("should record walked directories and config files", () => {
		expect.assertions(2);

		withProject(
			{
				"default.project.json": project({
					$className: "DataModel",
					ReplicatedStorage: { $path: "src/shared" },
				}),
				"src/shared/module.luau": "return {}",
			},
			(directory) => {
				const resolver = fromProject(directory);

				expect(resolver.walkedConfigFiles.size).toBeGreaterThan(0);
				expect(resolver.walkedDirectories.size).toBeGreaterThan(0);
			},
		);
	});

	it("should round-trip a direct module-file mapping", () => {
		expect.assertions(1);

		withProject(
			{
				"config.luau": "return {}",
				"default.project.json": project({
					$className: "DataModel",
					Config: { $path: "config.luau" },
				}),
			},
			(directory) => {
				const original = fromProject(directory);
				const restored = RojoResolver.fromState(original.getState());
				const configPath = path.join(directory, "config.luau");

				expect(restored.getRbxPathFromFilePath(configPath)).toStrictEqual(
					original.getRbxPathFromFilePath(configPath),
				);
			},
		);
	});
});

describe("non-module file partitions", () => {
	it("should resolve a partition that targets a non-module file", () => {
		expect.assertions(1);

		withProject(
			{
				"data.txt": "hello",
				"default.project.json": project({
					$className: "DataModel",
					Data: { $path: "data.txt" },
				}),
			},
			(directory) => {
				expect(
					fromProject(directory).getRbxPathFromFilePath(path.join(directory, "data.txt")),
				).toStrictEqual(["Data"]);
			},
		);
	});

	it("should resolve a non-script module extension under a partition", () => {
		expect.assertions(1);

		withProject(
			{
				"default.project.json": project({
					$className: "DataModel",
					ReplicatedStorage: { $path: "src/shared" },
				}),
				"src/shared/data.json": "{}",
			},
			(directory) => {
				expect(
					fromProject(directory).getRbxPathFromFilePath(
						path.join(directory, "src/shared/data.json"),
					),
				).toStrictEqual(["ReplicatedStorage", "data"]);
			},
		);
	});
});

describe("script sub-extension resolution", () => {
	it("should strip a .server sub-extension when resolving via a partition", () => {
		expect.assertions(1);

		withProject(
			{
				"default.project.json": project({
					$className: "DataModel",
					ServerScriptService: { $path: "src/server" },
				}),
				"src/server/main.server.luau": "return {}",
			},
			(directory) => {
				expect(
					fromProject(directory).getRbxPathFromFilePath(
						path.join(directory, "src/server/main.server.luau"),
					),
				).toStrictEqual(["ServerScriptService", "main"]);
			},
		);
	});
});

describe("fromTree", () => {
	it("should build a resolver from a tree object", () => {
		expect.assertions(1);

		withProject({ "src/value.luau": "return {}" }, (directory) => {
			// RojoTree's index signature collides with its $-prefixed metadata
			// keys (an upstream quirk), so a literal tree must be cast through
			// unknown.
			const tree: unknown = {
				$className: "DataModel",
				Shared: { $path: "src" },
			};
			const resolver = RojoResolver.fromTree(
				directory,
				tree as Parameters<typeof RojoResolver.fromTree>[1],
			);

			expect(
				resolver.getRbxPathFromFilePath(path.join(directory, "src/value.luau")),
			).toStrictEqual(["Shared", "value"]);
		});
	});
});
