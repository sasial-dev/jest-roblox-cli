import { defineConfig } from "@isentinel/jest-roblox";

export default defineConfig({
	rojoProject: "default.project.json",
	test: {
		projects: [
			{
				test: {
					displayName: "multi-root-e2e",
					include: ["pkg/src/**/*.spec.luau"],
				},
			},
		],
	},
});
