import type buffer from "node:buffer";
import { createHash } from "node:crypto";

export function hashBuffer(data: buffer.Buffer): string {
	return createHash("sha256").update(data).digest("hex");
}
