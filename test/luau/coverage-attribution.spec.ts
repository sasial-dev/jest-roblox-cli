import { spawnLute } from "@isentinel/luau-ast";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Drives the attribution module under the real lute binary, inlining it into the
// harness the same way the runner welds it. The harness exercises the pure
// snapshot/diff logic against a hand-built coverage hit table and calls error()
// on any failed assertion, so a non-zero lute exit fails this test. Requires
// `lute` on PATH (mise, in dev and CI). The source is read from disk (rather than
// imported) so the spec needs no `*.luau` ambient declaration.
const here = path.dirname(fileURLToPath(import.meta.url));
const moduleSource = fs.readFileSync(
	path.join(here, "../../luau/coverage-attribution.luau"),
	"utf-8",
);
const harness = fs.readFileSync(path.join(here, "coverage-attribution.harness.luau"), "utf-8");

describe("coverage attribution under lute", () => {
	it("should pass the attribution harness assertions", () => {
		expect.assertions(1);

		const script = harness.replace("__MODULE__", () => `(function()\n${moduleSource}\nend)()`);
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cov-attr-"));
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
