import type { ResolvedConfig } from "../config/schema.ts";
import template from "../materializer.bundled.luau";
import { buildJestArgv, type JestArgv } from "../test-script.ts";

export interface MaterializerInput {
	config: ResolvedConfig;
	pkg: string;
	project: string;
	testFiles: Array<string>;
}

interface EntryPayload {
	config: JestArgv;
	pkg: string;
	project: string;
}

interface WorkStealingPayload {
	entries: Array<EntryPayload>;
	invisibilityWindowSeconds: number;
	queueId: string;
}

export function generateMaterializerScript(inputs: Array<MaterializerInput>): string {
	return substitutePayload({ entries: buildEntries(inputs) });
}

/**
 * Generate the materializer script for work-stealing mode. The Roblox-side
 * runtime sees the `queueId` field and switches from sequential walk to
 * popping items off `MemoryStoreService:GetQueue(queueId, invisibilityWindowSeconds)`,
 * looking each one up in the embedded `entries` map.
 */
export function generateWorkStealingScript(
	inputs: ReadonlyArray<MaterializerInput>,
	queueId: string,
	invisibilityWindowSeconds: number,
): string {
	const payload: WorkStealingPayload = {
		entries: buildEntries(inputs),
		invisibilityWindowSeconds,
		queueId,
	};
	return substitutePayload(payload);
}

function buildEntries(inputs: ReadonlyArray<MaterializerInput>): Array<EntryPayload> {
	return inputs.map((input) => {
		return {
			config: buildJestArgv({ config: input.config, testFiles: input.testFiles }),
			pkg: input.pkg,
			project: input.project,
		};
	});
}

function substitutePayload(payload: object): string {
	const serialized = String(JSON.stringify(payload));
	if (serialized.includes("]==]")) {
		throw new Error("workspace materializer payload contains forbidden sequence ']==]'");
	}

	return template.replace("__CONFIG_JSON__", () => serialized);
}
