import { defineConfig } from "@isentinel/jest-roblox";

export default defineConfig({
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
});
