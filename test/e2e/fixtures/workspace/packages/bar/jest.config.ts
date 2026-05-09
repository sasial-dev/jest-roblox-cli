export default {
	rojoProject: "test.project.json",
	test: {
		// See packages/foo/jest.config.ts — same workaround.
		passWithNoTests: true,
		testPathIgnorePatterns: ["bar\\.spec\\.luau$"],
	},
};
