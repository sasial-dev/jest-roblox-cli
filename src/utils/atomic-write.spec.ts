import { fromAny } from "@total-typescript/shoehorn";

import { vol } from "memfs";
import { Buffer } from "node:buffer";
import * as fs from "node:fs";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { atomicWrite } from "./atomic-write.ts";

vi.mock(import("node:fs"), async () => {
	const memfs = await vi.importActual<typeof import("memfs")>("memfs");
	return fromAny({ ...memfs.fs, default: memfs.fs });
});

describe(atomicWrite, () => {
	it("should write contents to the target path", () => {
		expect.assertions(1);

		onTestFinished(() => {
			vol.reset();
		});

		atomicWrite("/coverage/manifest.json", "hello");

		expect(vol.readFileSync("/coverage/manifest.json", "utf-8")).toBe("hello");
	});

	it("should create missing parent directories before writing", () => {
		expect.assertions(1);

		onTestFinished(() => {
			vol.reset();
		});

		atomicWrite("/nested/deep/coverage/manifest.json", "hello");

		expect(vol.existsSync("/nested/deep/coverage/manifest.json")).toBeTrue();
	});

	it("should accept Buffer contents", () => {
		expect.assertions(1);

		onTestFinished(() => {
			vol.reset();
		});

		atomicWrite("/coverage/place.rbxl", Buffer.from([0x00, 0x01, 0x02]));

		expect(vol.readFileSync("/coverage/place.rbxl")).toStrictEqual(
			Buffer.from([0x00, 0x01, 0x02]),
		);
	});

	it("should leave no file at the target path when the rename fails", () => {
		expect.assertions(2);

		onTestFinished(() => {
			vol.reset();
		});

		vi.spyOn(fs, "renameSync").mockImplementation(() => {
			throw new Error("ENOSPC: no space left on device");
		});

		expect(() => {
			atomicWrite("/coverage/manifest.json", "hello");
		}).toThrow("ENOSPC");
		expect(vol.existsSync("/coverage/manifest.json")).toBeFalse();
	});
});
