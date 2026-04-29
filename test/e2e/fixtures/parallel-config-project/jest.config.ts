import { defineConfig } from "@isentinel/jest-roblox";

export default defineConfig({
	parallel: 4,
	rojoProject: "default.project.json",
	test: {
		projects: [
			{
				test: {
					displayName: "parallel-config-e2e",
					include: ["src/**/*.spec.luau"],
				},
			},
		],
	},
});
