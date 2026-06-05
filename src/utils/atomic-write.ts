import type { Buffer } from "node:buffer";
import * as fs from "node:fs";
import * as path from "node:path";
import process from "node:process";

/**
 * Publish `contents` to `targetPath` atomically: write to a sibling temp file
 * then `renameSync` into place, so a reader never observes a partial write at
 * the target. The temp file lives in the target's own directory to keep the
 * rename on a single filesystem. Parent directories are created as needed.
 *
 * The guarantee is scoped to `targetPath`: a failed write leaves the temp file
 * behind rather than a partial target — temp cleanup is not attempted.
 */
export function atomicWrite(targetPath: string, contents: Buffer | string): void {
	const directory = path.dirname(targetPath);
	fs.mkdirSync(directory, { recursive: true });
	const temporaryPath = path.join(directory, `${path.basename(targetPath)}.tmp.${process.pid}`);
	fs.writeFileSync(temporaryPath, contents);
	fs.renameSync(temporaryPath, targetPath);
}
