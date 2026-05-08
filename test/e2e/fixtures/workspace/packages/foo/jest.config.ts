import { defineConfig } from "@isentinel/jest-roblox";

export default defineConfig({
	rojoProject: "test.project.json",
	test: {
		// Skip the workspace-mode placeholder spec when this fixture is run as
		// a standalone nx project (`@e2e/foo:test`) — there is no game.rbxl in
		// this directory, only a synthesized one when driven via `--workspace`.
		// The workspace runner's discoverProjectTestFiles bypasses
		// testPathIgnorePatterns, so the workspace-pipeline e2e still finds it.
		passWithNoTests: true,
		testPathIgnorePatterns: ["foo\\.spec\\.luau$"],
	},
});
