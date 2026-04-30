# Spike: staged materializer for multi-package OCALE batching

Validation of the design proposed in HAL-154 (multi-package batched test execution). Run against paralov 2026-04-24.

## What this proves

Three Roblox packages with deliberately conflicting `ReplicatedStorage` root claims (`friends-package`, `data-package`) plus one ModuleScript-shape package (`uuid-generator`) can be tested **sequentially in one OCALE task** by:

1. Building one place that nests each package's full DataModel-shaped tree under `ServerStorage.__pkg_stage.<pkg>` (instead of mounting them at conflicting live roots).
2. Running an in-task Luau script ("materializer") that, per package, clones the staged subtree into the live services the package expects (`ReplicatedStorage.Packages`, `.Shared`, `.Client`, etc.), runs `Jest.runCLI`, captures results, then resets only the Instances it materialized before the next package.

End-to-end result: 3 packages, 168 tests (93 friends + 67 data + 8 uuid), ~23 seconds total round-trip in one OCALE task. friends 93/93, uuid 8/8, data at its known baseline 67/14 (failures inherent to data, not introduced by the spike).

## Files

```text
spike-mega.project.json     # Rojo project staging 3 paralov packages under __pkg_stage
flatten-stage.luau          # Lune post-process: coerces nested DataModel/Service to Folder.
                            # Production design DOES NOT need this — synthesizer is in TS instead.
inspect.luau                # Lune debug helper for reading the built rbxl
run.mjs                     # Standalone Node OCALE driver (no jest-roblox-cli dependency)
tasks/
  phase2a.luau              # Sanity check: load + materialize + tree snapshot, no Jest
  phase2b.luau              # Single-package: materialize friends + run Jest.runCLI
  phase2c.luau              # Sequential 3-package run with identity-based reset + folder-merge
  phase2c-data-only.luau    # Data-only baseline (proves the 14 data failures are inherent)
```

## Reading order

1. `phase2a.luau` — minimal materializer, validates the rbxl loads and tree moves correctly.
2. `phase2b.luau` — adds `Jest.runCLI` invocation; validates Jest finds and runs spec files post-materialization.
3. `phase2c.luau` — adds reset + multi-package loop; the final shape the production materializer is based on.

## Key gotchas discovered (now in HAL-154)

- `ServerScriptService.LoadStringEnabled = true` is required (Jest's `JestRuntime` uses `loadstring`).
- Rojo's `$path` to a DataModel-rooted project.json from a non-root position generates nested `DataModel`/Service Instances. Spike works around with Lune flatten; production design avoids by synthesizing the place project.json in TypeScript.
- Identity-tracked reset (only destroying Instances we materialized) preserves mega-place root infra (`Test`, `DevPackages`).
- Folder-merge during materialize lets a package augment existing infra containers (e.g., data-package adds `MockDataStoreService` into mega-place's `DevPackages`) without creating duplicate siblings.
- `_G` state survives across `Jest.runCLI` calls in same VM. Probe added (`_G.__spike_bleed`) confirmed leak; mitigation = explicit reset between packages.

## Caveats

- Paths inside `spike-mega.project.json` are relative to its original location at `<paralov>/apps/roblox-packages/spike-staged/`. To re-run the spike, copy back into a paralov-shaped workspace or rewrite paths.
- Spike packages are code-only. Asset-bearing package handling (`InsertService:LoadAssetVersion`) was deliberately deferred — design covered in HAL-154.
- Spike runs sequentially in one OCALE task; production design adds N parallel tasks via MemoryStore work-stealing queue. Spike's sequential model is the inner loop of one parallel task.

## Linked context

- HAL-154 — Multi-package batched test execution PRD
- Memory note: `project_paralov_spike_staged_materializer.md`
