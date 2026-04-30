--!strict
-- Baseline: run data alone to check if 14 DataService.spec failures are
-- inherent to data or caused by friends running first.

local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")
local ServerStorage = game:GetService("ServerStorage")
local StarterPlayer = game:GetService("StarterPlayer")

local stage = ServerStorage:FindFirstChild("__pkg_stage")
assert(stage)

local function cloneInto(source: Instance, dest: Instance)
	for _, child in source:GetChildren() do
		local existing = dest:FindFirstChild(child.Name)
		if existing and (existing:IsA("Folder") or existing:IsA("Model")) and (child:IsA("Folder") or child:IsA("Model")) then
			cloneInto(child, existing)
		else
			child:Clone().Parent = dest
		end
	end
end

local staged = stage:FindFirstChild("data")
assert(staged)
for _, stagedSvc in staged:GetChildren() do
	if stagedSvc.Name == "StarterPlayer" then
		for _, stagedSub in stagedSvc:GetChildren() do
			local liveSub = StarterPlayer:FindFirstChild(stagedSub.Name)
			if liveSub then cloneInto(stagedSub, liveSub) end
		end
	else
		local liveSvc = game:FindFirstChild(stagedSvc.Name)
		if liveSvc then cloneInto(stagedSvc, liveSvc) end
	end
end

local Jest = (require :: any)(ReplicatedStorage.Test.Jest)

local projects: { Instance } = {}
for _, rootName in { "Shared", "Client" } do
	local root = ReplicatedStorage:FindFirstChild(rootName)
	if root then
		for _, desc in root:GetDescendants() do
			if desc:IsA("ModuleScript") and desc.Name == "jest.config" then
				table.insert(projects, desc)
			end
		end
	end
end
local server = ServerScriptService:FindFirstChild("Server")
if server then
	for _, desc in server:GetDescendants() do
		if desc:IsA("ModuleScript") and desc.Name == "jest.config" then
			table.insert(projects, desc)
		end
	end
end

local tJest0 = os.clock()
local runOk, runResult = pcall(function()
	return Jest.runCLI(script, { testMatch = {"**/*.spec"}, mockDataModel = true }, projects):expect()
end)
local jestMs = math.floor((os.clock() - tJest0) * 1000)

local function summarize(res)
	if type(res) ~= "table" then return nil end
	local r = res.results or res
	local suites = {}
	if r.testResults then
		for _, s in r.testResults do
			local assertionResults = {}
			if s.testResults then
				for _, t in s.testResults do
					if t.status == "failed" then
						table.insert(assertionResults, {
							title = t.title,
							failureMessages = t.failureMessages,
						})
					end
				end
			end
			table.insert(suites, {
				testFilePath = tostring(s.testFilePath),
				numFailingTests = s.numFailingTests,
				numPassingTests = s.numPassingTests,
				failedTestsDetail = assertionResults,
			})
		end
	end
	return {
		numTotalTests = r.numTotalTests,
		numPassedTests = r.numPassedTests,
		numFailedTests = r.numFailedTests,
		success = r.success,
		suites = suites,
	}
end

return HttpService:JSONEncode({
	phase = "2c-baseline",
	pkg = "data-only",
	ok = runOk,
	jestMs = jestMs,
	projectCount = #projects,
	summary = if runOk then summarize(runResult) else nil,
	error = if not runOk then tostring(runResult) else nil,
})
