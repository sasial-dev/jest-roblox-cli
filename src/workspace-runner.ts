import * as fs from "node:fs";
import * as path from "node:path";
import process from "node:process";

import type { Backend } from "./backends/interface.ts";
import type { ResolvedConfig } from "./config/schema.ts";
import {
	buildProjectJob,
	executeBackend,
	type ExecuteResult,
	processProjectResult,
} from "./executor.ts";
import { type PackageDescriptor, synthesize } from "./staging/synthesizer.ts";
import {
	generateMaterializerScript,
	type MaterializerInput,
} from "./staging/test-script-staged.ts";
import { buildWithRojo } from "./utils/rojo-builder.ts";
import { ensurePackageDirectories } from "./workspace/ensure-paths.ts";
import type { PackageInfo } from "./workspace/package-resolver.ts";
import { type PreflightError, validatePackages } from "./workspace/preflight.ts";

const SYNTHESIZED_PROJECT_FILE = "synthesized.project.json";
const SYNTHESIZED_PLACE_FILE = "synthesized.rbxl";
const WORKSPACE_CACHE_DIRECTORY = path.join(".jest-roblox", "workspace");
const ROJO_PROJECT_DEFAULT = "test.project.json";

export interface RunWorkspaceOptions {
	backend: Backend;
	config: ResolvedConfig;
	packageInfos: Array<PackageInfo>;
	version: string;
	workspaceRoot: string;
}

export interface WorkspaceProjectResult {
	displayName: string;
	result: ExecuteResult;
}

export async function runWorkspace(
	options: RunWorkspaceOptions,
): Promise<Array<WorkspaceProjectResult> | undefined> {
	const { backend, config, packageInfos, version, workspaceRoot } = options;
	const startTime = Date.now();

	const descriptors: Array<PackageDescriptor> = packageInfos.map((info) => {
		return {
			name: info.name,
			packageDirectory: info.packageDirectory,
			rojoProjectPath: path.resolve(
				info.packageDirectory,
				config.rojoProject ?? ROJO_PROJECT_DEFAULT,
			),
		};
	});

	ensurePackageDirectories(descriptors);

	const errors = validatePackages(descriptors);
	if (errors.length > 0) {
		writePreflightErrors(errors);
		return undefined;
	}

	const cacheDirectory = path.join(workspaceRoot, WORKSPACE_CACHE_DIRECTORY);
	fs.mkdirSync(cacheDirectory, { recursive: true });

	const synthProjectPath = path.join(cacheDirectory, SYNTHESIZED_PROJECT_FILE);
	const synthRbxlPath = path.join(cacheDirectory, SYNTHESIZED_PLACE_FILE);

	const projectJson = synthesize({ packages: descriptors });
	fs.writeFileSync(synthProjectPath, projectJson);
	buildWithRojo(synthProjectPath, synthRbxlPath);

	const workspaceConfigs = packageInfos.map((info): ResolvedConfig => {
		return {
			...config,
			placeFile: synthRbxlPath,
			rootDir: info.packageDirectory,
		};
	});

	const jobs = workspaceConfigs.map((workspaceConfig, index) => {
		// eslint-disable-next-line ts/no-non-null-assertion -- length matches packageInfos
		const info = packageInfos[index]!;
		return buildProjectJob({
			config: workspaceConfig,
			displayName: info.name,
			testFiles: [],
		});
	});

	const inputs: Array<MaterializerInput> = workspaceConfigs.map((workspaceConfig, index) => {
		// eslint-disable-next-line ts/no-non-null-assertion -- length matches packageInfos
		const info = packageInfos[index]!;
		return { name: info.name, config: workspaceConfig, testFiles: [] };
	});

	const script = generateMaterializerScript(inputs);

	const { results, timing: backendTiming } = await executeBackend(
		backend,
		jobs,
		undefined,
		script,
	);

	return results.map((entry, index) => {
		// eslint-disable-next-line ts/no-non-null-assertion -- length matches jobs
		const workspaceConfig = workspaceConfigs[index]!;
		// eslint-disable-next-line ts/no-non-null-assertion -- length matches packageInfos
		const info = packageInfos[index]!;
		return {
			displayName: info.name,
			result: processProjectResult(entry, {
				backendTiming,
				config: workspaceConfig,
				deferFormatting: true,
				startTime,
				version,
			}),
		};
	});
}

function writePreflightErrors(errors: Array<PreflightError>): void {
	process.stderr.write("Pre-flight validation failed:\n");
	for (const error of errors) {
		process.stderr.write(`  ${error.package}: ${error.reason}\n`);
	}
}
