/**
 * Raw hit counts for a single file, keyed by statement/function index.
 */
export interface RawFileCoverage {
	b?: Record<string, Array<number>>;
	f?: Record<string, number>;
	s: Record<string, number>;
}

/**
 * Raw coverage data for all files, keyed by original Luau-relative path.
 */
export type RawCoverageData = Record<string, RawFileCoverage>;
