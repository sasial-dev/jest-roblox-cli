--!strict
-- Phase 2c: sequential multi-package. Runs friends, resets, runs data, both
-- inside one OCALE task.
--
-- Design:
-- * Test/DevPackages live at mega-place root (outside __pkg_stage). They
--   persist across runs — packages that don't stage them can still use them.
-- * Materialize recurses on folder collisions (merge) instead of creating
--   duplicate siblings — so data's DevPackages children (MockDataStoreService
--   etc.) get merged into the mega-place's DevPackages container.
-- * Reset is identity-based: only destroys Instances WE materialized. The
--   mega-place root infra survives. Merged leaves are tracked, so they do
--   get cleaned up between packages.

local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")
local ServerStorage = game:GetService("ServerStorage")
local StarterPlayer = game:GetService("StarterPlayer")

local PACKAGES = { "friends", "data", "uuid-generator" }

local stage = ServerStorage:FindFirstChild("__pkg_stage")
assert(stage, "__pkg_stage missing")

-- Instances we materialized, in order. Destroyed on reset. Does NOT include
-- mega-place root instances (Test, DevPackages, ServerScriptService props, etc).
local materialized: { Instance } = {}

local function resetLiveRoots()
	for i = #materialized, 1, -1 do
		local inst = materialized[i]
		if inst and inst.Parent then
			inst:Destroy()
		end
	end
	table.clear(materialized)
	_G.__spike_bleed = nil
end

local function cloneInto(source: Instance, dest: Instance): number
	local n = 0
	for _, child in source:GetChildren() do
		local existing = dest:FindFirstChild(child.Name)
		if existing and (existing:IsA("Folder") or existing:IsA("Model")) and (child:IsA("Folder") or child:IsA("Model")) then
			-- Merge children into the existing folder-like container.
			n += cloneInto(child, existing)
		else
			local cloned = child:Clone()
			cloned.Parent = dest
			table.insert(materialized, cloned)
			n += 1
		end
	end
	return n
end

local function materialize(pkgName: string): number
	local staged = stage:FindFirstChild(pkgName)
	assert(staged, "no stage for " .. pkgName)

	-- ModuleScript-shaped stage (e.g. uuid-generator): clone the whole
	-- ModuleScript as a direct child of ReplicatedStorage, preserving its
	-- staged name. Matches paralov's own convention of mounting code-only
	-- packages at ReplicatedStorage.<pkg-name>.
	if staged:IsA("ModuleScript") then
		local cloned = staged:Clone()
		cloned.Parent = ReplicatedStorage
		table.insert(materialized, cloned)
		return 1
	end

	-- Shadow-DataModel-shaped stage (e.g. friends, data): splat each
	-- service-named child's contents into the live service of the same name.
	local cloneCount = 0
	for _, stagedSvc in staged:GetChildren() do
		local svcName = stagedSvc.Name
		if svcName == "StarterPlayer" then
			for _, stagedSub in stagedSvc:GetChildren() do
				local liveSub = StarterPlayer:FindFirstChild(stagedSub.Name)
				if liveSub then
					cloneCount += cloneInto(stagedSub, liveSub)
				end
			end
		else
			local liveSvc = game:FindFirstChild(svcName)
			if liveSvc then
				cloneCount += cloneInto(stagedSvc, liveSvc)
			end
		end
	end
	return cloneCount
end

local function collectJestConfigs(): { Instance }
	local configs: { Instance } = {}
	local seen: { [Instance]: boolean } = {}
	for _, inst in materialized do
		if inst:IsA("ModuleScript") and inst.Name == "jest.config" and not seen[inst] then
			seen[inst] = true
			table.insert(configs, inst)
		end
		for _, desc in inst:GetDescendants() do
			if desc:IsA("ModuleScript") and desc.Name == "jest.config" and not seen[desc] then
				seen[desc] = true
				table.insert(configs, desc)
			end
		end
	end
	return configs
end

local function summarize(res: any): any
	if type(res) ~= "table" then return nil end
	local r = res.results or res
	local suites = {}
	if r.testResults then
		for _, s in r.testResults do
			table.insert(suites, {
				testFilePath = tostring(s.testFilePath),
				numFailingTests = s.numFailingTests,
				numPassingTests = s.numPassingTests,
				numPendingTests = s.numPendingTests,
				testExecError = s.testExecError and {
					message = tostring(s.testExecError.message),
				} or nil,
			})
		end
	end
	return {
		numTotalTests = r.numTotalTests,
		numPassedTests = r.numPassedTests,
		numFailedTests = r.numFailedTests,
		numPendingTests = r.numPendingTests,
		numTotalTestSuites = r.numTotalTestSuites,
		numPassedTestSuites = r.numPassedTestSuites,
		numFailedTestSuites = r.numFailedTestSuites,
		success = r.success,
		suites = suites,
	}
end

local function runOne(pkgName: string, isFirst: boolean): any
	local gBleedAtStart = _G.__spike_bleed

	local tReset0 = os.clock()
	if not isFirst then
		resetLiveRoots()
	end
	local resetMs = math.floor((os.clock() - tReset0) * 1000)

	local tMat0 = os.clock()
	local cloneCount = materialize(pkgName)
	local materializeMs = math.floor((os.clock() - tMat0) * 1000)

	local Test = ReplicatedStorage:FindFirstChild("Test")
	if not Test then
		return { pkg = pkgName, ok = false, error = "no ReplicatedStorage.Test" }
	end
	local JestModule = Test:FindFirstChild("Jest")
	if not JestModule then
		return { pkg = pkgName, ok = false, error = "no Test.Jest" }
	end

	local Jest = (require :: any)(JestModule)
	local projects = collectJestConfigs()

	local config = { testMatch = { "**/*.spec" }, mockDataModel = true }

	local tJest0 = os.clock()
	local runOk, runResult = pcall(function()
		return Jest.runCLI(script, config, projects):expect()
	end)
	local jestMs = math.floor((os.clock() - tJest0) * 1000)

	_G.__spike_bleed = true

	return {
		pkg = pkgName,
		ok = runOk,
		resetMs = resetMs,
		materializeMs = materializeMs,
		cloneCount = cloneCount,
		jestMs = jestMs,
		projectCount = #projects,
		gBleedAtStart = tostring(gBleedAtStart),
		summary = if runOk then summarize(runResult) else nil,
		error = if not runOk then tostring(runResult) else nil,
	}
end

local results = {}
for index, pkgName in PACKAGES do
	table.insert(results, runOne(pkgName, index == 1))
end

return HttpService:JSONEncode({ phase = "2c", order = PACKAGES, results = results })
