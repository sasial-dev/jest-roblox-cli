import { defineConfig } from "@isentinel/jest-roblox";

export default defineConfig({
	rojoProject: "test.project.json",
	test: {
		// See packages/foo/jest.config.ts — same workaround.
		passWithNoTests: true,
		testPathIgnorePatterns: ["bar\\.spec\\.luau$"],
	},
});
