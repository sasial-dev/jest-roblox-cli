/* eslint-disable vitest/prefer-each, vitest/prefer-expect-assertions -- benchmarks are not tests: `bench` declares no assertions and loops to parametrize input size */
import { bench, describe } from "vitest";

import { DEFAULT_CONFIG } from "../config/schema.ts";
import { generateMaterializerScript, type MaterializerInput } from "./test-script-staged.ts";

// The materializer payload is built once per workspace run and grows with the
// (package, project) count. This bench guards the per-entry `buildJestArgv` +
// JSON substitution against regressions as the workspace scales.
function materializerInputs(
	packageCount: number,
	filesPerPackage: number,
): Array<MaterializerInput> {
	const inputs: Array<MaterializerInput> = [];
	for (let index = 0; index < packageCount; index++) {
		const directory = `/repo/packages/pkg-${String(index)}`;
		const packageName = `@scope/pkg-${String(index)}`;
		const testFiles: Array<string> = [];
		for (let fileIndex = 0; fileIndex < filesPerPackage; fileIndex++) {
			testFiles.push(`${directory}/out/file-${String(fileIndex)}.spec.luau`);
		}

		inputs.push({
			config: { ...DEFAULT_CONFIG, rootDir: directory },
			pkg: packageName,
			project: packageName,
			testFiles,
		});
	}

	return inputs;
}

describe(generateMaterializerScript, () => {
	for (const count of [10, 50, 200]) {
		const inputs = materializerInputs(count, 10);
		bench(`${String(count)} packages x10 files`, () => {
			generateMaterializerScript(inputs);
		});
	}
});
