import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const luauPlugin = {
	name: "luau-raw",
	load(id: string) {
		if (id.endsWith(".lua")) {
			return "export default {};";
		}

		if (!id.endsWith(".luau")) {
			return;
		}

		const content = readFileSync(id, "utf-8");
		return `export default ${JSON.stringify(content)};`;
	},
};

const setupFiles = ["./test/setup/enable-colors.ts", "./test/setup/jest-extended.ts"];

export default defineConfig({
	plugins: [luauPlugin],
	test: {
		coverage: {
			exclude: [
				"dist/**",
				"src/**/*.bench.ts",
				"src/**/*.luau",
				"src/**/*.spec-d.ts",
				"test/e2e/**",
				"test/mocks/**",
				"package.json",
			],
			thresholds: {
				branches: 100,
				functions: 100,
				lines: 100,
				statements: 100,
			},
		},
		projects: [
			{
				plugins: [luauPlugin],
				test: {
					name: "unit",
					// `*.bench.ts` benchmarks (run via `vitest bench`) live
					// beside the unit specs. Scope them to this project so the
					// e2e/live projects — the latter has a network globalSetup —
					// never pick them up.
					benchmark: {
						include: ["src/**/*.bench.ts"],
					},
					clearMocks: true,
					env: {
						GITHUB_ACTIONS: "",
					},
					exclude: [
						"src/**/__fixtures__/**",
						"test/fixtures/**",
						"test/e2e/**",
						"**/src/types/**",
						"./src/cli.ts",
						"**/*.luau",
					],
					include: ["src/**/*.spec.ts", "test/**/*.spec.ts"],
					restoreMocks: true,
					setupFiles,
					typecheck: {
						checker: "tsgo",
						enabled: true,
						include: ["src/**/*.spec-d.ts"],
						tsconfig: "./tsconfig.spec.json",
					},
					unstubEnvs: true,
				},
			},
			{
				plugins: [luauPlugin],
				test: {
					name: "e2e",
					// Benchmarks belong to the unit project only; opt this one
					// out so `vitest bench` never runs them here.
					benchmark: {
						include: [],
					},
					clearMocks: true,
					include: ["test/e2e/cli/**/*.e2e.spec.ts"],
					restoreMocks: true,
					setupFiles,
					testTimeout: 30_000,
					unstubEnvs: true,
				},
			},
			{
				plugins: [luauPlugin],
				test: {
					name: "live",
					// Benchmarks belong to the unit project only; opt this one
					// out so `vitest bench` never triggers the network
					// globalSetup.
					benchmark: {
						include: [],
					},
					clearMocks: true,
					fileParallelism: false,
					globalSetup: ["./test/e2e/fixtures/live-place/global-setup.ts"],
					include: [
						"test/e2e/contract/**/*.spec.ts",
						"test/e2e/project/**/*.e2e.spec.ts",
						"test/e2e/workspace/**/*.e2e.spec.ts",
					],
					maxWorkers: 1,
					pool: "forks",
					restoreMocks: true,
					setupFiles,
					testTimeout: 60_000,
					unstubEnvs: true,
				},
			},
		],
	},
});
