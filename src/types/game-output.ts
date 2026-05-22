export interface GameOutputEntry {
	message: string;
	messageType: number;
	timestamp: number;
}

/**
 * One group in an Aggregated Game Output file. `package` is omitted in
 * `multi` mode (a single config has no package identity) and present in
 * `workspace` mode.
 */
export interface PackageGameOutput {
	entries: Array<GameOutputEntry>;
	package?: string;
	project: string;
}
