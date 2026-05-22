# jest-roblox-cli

CLI tool that runs Jest tests inside a real Roblox runtime via Open Cloud
(or a local Studio backend) and maps the results back to TypeScript source.

## Language

**Game Output**:
The dump of every line that surfaced in the Roblox Output during a test run —
native `print`/`warn`/`error`, engine warnings, anything `LogService` would
return. Surfaced via the `gameOutput` config field (`string | true`; `true` ⇒
`game-output.log` under the root) or `--gameOutput <path>` flag, as a JSON
array of `{ message, messageType, timestamp }` records. Sourced from
`LogService.MessageOut`. Used for human inspection when a test run misbehaves.
_Avoid_: "Jest output", "stdout", "log dump"

**Aggregated Game Output**:
The single Game Output file written when more than one source contributes —
grouped, not the flat `single` array. In `multi` mode (one config, several
projects) the groups are `[{ project, entries }]`; in `workspace` mode they
are `[{ package, project, entries }]`, written under the workspace root with
its path/enablement consensus-resolved as a Workspace Run Option. One group
per (package?, project) that ran, even if `entries` is empty.
_Avoid_: "merged log", "combined output"

**Per-package Game Output**:
In workspace mode, one `.jest-roblox/output/<pkg>--<project>.gameOutput.json`
per selected (package, project), each a flat `{ message, messageType,
timestamp }` array. Gated by `workspace.gameOutput: true`. Independent of
Aggregated Game Output — a single run can emit both.
_Avoid_: "split logs"

**Banner Output**:
The narrower buffer that captures Jest's own writes to its `process.stdout` /
`process.stderr` Writeables via `InterceptWriteable`. Used only by the CLI's
error banner to surface synchronous exit messages (e.g. "No tests found,
exiting with code 1") that would otherwise be eaten by the Promise
rejection unwind. Not exposed as a user-facing flag.
_Avoid_: "captured stdout", "intercepted writes"

**Per-package Config**:
The loaded jest config for a single workspace package, possibly resolved via
`extends: "../jest.shared.ts"`. Source of truth for everything jest-shaped —
`testMatch`, `setupFiles`, `coverageCache`, `coveragePathIgnorePatterns`,
`rojoProject`, and so on. In workspace mode, the runtime reads these knobs
per-package; the workspace-root config file is not consulted for them.
(`gameOutput`, `outputFile`, `workspace.gameOutput`, and `workspace.outputFile`
are the exception — declared per-package but consensus-resolved as Workspace
Run Options.)
_Avoid_: "root config", "workspace-level config" — both imply a workspace
root config that drives package behavior, which is no longer the model.

**Workspace Run Options**:
The narrow set of knobs that are atomic to one workspace invocation:
`backend`, `color`, `formatters`, `parallel`, `placeId`, `pollInterval`,
`port`, `silent`, `universeId`, `gameOutput` (the Aggregated Game Output
path), `workspace.gameOutput` (the Per-package Game Output toggle),
`outputFile` (the aggregated result path), and `workspace.outputFile` (the
per-package result toggle). They
describe what the run targets and how the CLI presents output — not how any
individual package runs. Resolved by
`buildWorkspaceRunOptions` as CLI flag (or documented env var) > per-package
consensus > `DEFAULT_CONFIG`. Per-package consensus means: every selected
package's raw config must declare the field equally, OR none of them declare
it; mixed declarations throw `WorkspaceConsensusError`.
_Avoid_: "workspace config" — the value isn't loaded from a workspace-root
config file.

**CLI Options**:
The argv parse result (`CliOptions` type). Flags passed explicitly on the
command line, plus any short-form aliases. CLI options layer on top of both
Workspace Run Options (via the resolution order above) and Per-package
Config (via `mergeCliWithConfig` in `loadPackages`).

## Relationships

- **Game Output** and **Banner Output** are two distinct captures with two
  distinct sinks: one feeds a user-readable file, the other feeds the CLI
  error banner. They are not merged or deduplicated.
- **Banner Output** ⊂ **Game Output** in content (Jest's `process.stdout`
  ultimately calls `print`, which lands in `LogService`), but the two
  captures run independently — Banner Output stays in scope as the
  synchronous, exit-safe path for the error banner.

## Example dialogue

> **Dev:** "My `warn(...)` in a spec doesn't appear in `--gameOutput`."
> **Maintainer:** "**Game Output** dumps `LogService.MessageOut`. If your
> warn isn't there, the LogService capture isn't wired up or the run
> didn't reach the warn. Either way it's not a **Banner Output** issue —
> the banner only shows up on Luau errors."

## Flagged ambiguities

- "Game Output" once meant "whatever the CLI returns as the second output
  slot of the Luau task script". That slot is implementation detail
  (sometimes `[]` placeholder, sometimes a real payload); the term now
  refers exclusively to the LogService-sourced dump regardless of
  transport.
