import { mergeCliWithConfig } from "./config/merge.ts";
import type { CliOptions, ProjectEntry, ResolvedConfig } from "./config/schema.ts";
import { runMultiProject } from "./run/multi.ts";
import { runSingleProject } from "./run/single.ts";
import type { RunResult } from "./run/types.ts";
import { runWorkspaceMode } from "./run/workspace.ts";
import { createTimingCollector } from "./timing/orchestration-collector.ts";

export function isWorkspaceInvocation(cli: CliOptions): boolean {
	return cli.workspace === true || cli.packages !== undefined || cli.affectedSince !== undefined;
}

export async function runJestRoblox(cli: CliOptions, config: ResolvedConfig): Promise<RunResult> {
	// One collector per top-level run, flushed in `finally` so a TIMING run
	// still emits the host waterfall when a profiled phase throws (missing
	// lute, rojo build failure, dispatch timeout) — exactly the slow or
	// broken runs the profiler exists to diagnose. Disabled (TIMING unset)
	// every span is a no-op so behavior stays byte-identical.
	const timing = createTimingCollector();
	try {
		// Workspace mode resolves its own per-package config. The one exception
		// is `workspace.root`/`workspace.packages`: those come from the
		// bootstrap config (loaded from cwd or --workspace-root, root anchored
		// absolute at load) and drive package enumeration in repos without a
		// pnpm-workspace.yaml.
		if (isWorkspaceInvocation(cli)) {
			return await runWorkspaceMode(cli, config.workspace, timing);
		}

		// Single/multi paths keep the CLI > config precedence so programmatic
		// callers passing a raw config still get CLI overrides folded in.
		const merged = mergeCliWithConfig(cli, config);
		const rawProjects = (merged as unknown as { projects?: Array<ProjectEntry> }).projects;
		if (rawProjects !== undefined && rawProjects.length > 0) {
			return await runMultiProject({ cli, config: merged, rawProjects, timing });
		}

		return await runSingleProject({ cli, config: merged, timing });
	} finally {
		timing.flushTimingReport();
	}
}
