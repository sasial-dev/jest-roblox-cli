import { spawnLute } from "@isentinel/luau-ast";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Drives the per-test coverage hook under lute. Its coverage-attribution
// dependency is inlined in place of the relative require, then the whole module
// is inlined into the harness the same way the runner welds it. Requires `lute`
// on PATH (mise, in dev and CI).
const here = path.dirname(fileURLToPath(import.meta.url));
const luauDirectory = path.join(here, "../../luau");
const attributionSource = fs.readFileSync(
	path.join(luauDirectory, "coverage-attribution.luau"),
	"utf-8",
);
const moduleSource = fs
	.readFileSync(path.join(luauDirectory, "per-test-coverage.luau"), "utf-8")
	.replace(
		'require("./coverage-attribution")',
		() => `(function()\n${attributionSource}\nend)()`,
	);
const harness = fs.readFileSync(path.join(here, "per-test-coverage.harness.luau"), "utf-8");

describe("per-test coverage hook under lute", () => {
	it("should pass the per-test coverage harness assertions", () => {
		expect.assertions(1);

		const script = harness.replace("__MODULE__", () => `(function()\n${moduleSource}\nend)()`);
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "per-test-cov-"));
		const scriptPath = path.join(directory, "harness.luau");
		fs.writeFileSync(scriptPath, script, "utf-8");

		try {
			const stdout = spawnLute({ args: [], scriptPath });

			expect(stdout).toContain("ALL OK");
		} finally {
			fs.rmSync(directory, { force: true, recursive: true });
		}
	});
});
