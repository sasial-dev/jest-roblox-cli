--!strict
-- Phase 2b: materialize friends-package from staging into live services,
-- find Jest in ReplicatedStorage.Test, and run Jest.runCLI on the
-- materialized subtree. No reset (single package, one shot).

local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")
local ServerStorage = game:GetService("ServerStorage")

local stage = ServerStorage:FindFirstChild("__pkg_stage")
assert(stage, "__pkg_stage missing")
local friends = stage:FindFirstChild("friends")
assert(friends, "__pkg_stage.friends missing")

local tMat0 = os.clock()
local cloneCount = 0
for _, stagedSvc in friends:GetChildren() do
	local liveSvc = game:FindFirstChild(stagedSvc.Name)
	if liveSvc then
		for _, child in stagedSvc:GetChildren() do
			child:Clone().Parent = liveSvc
			cloneCount += 1
		end
	end
end
local materializeMs = math.floor((os.clock() - tMat0) * 1000)

local Test = ReplicatedStorage:FindFirstChild("Test")
assert(Test, "ReplicatedStorage.Test missing")
local JestModule = Test:FindFirstChild("Jest")
assert(JestModule, "ReplicatedStorage.Test.Jest missing")

local Jest = (require :: any)(JestModule)

local projects: { Instance } = {}
local projectPaths: { string } = {}
local function collectConfigs(root: Instance, prefix: string)
	for _, desc in root:GetDescendants() do
		if desc:IsA("ModuleScript") and desc.Name == "jest.config" then
			table.insert(projects, desc)
			table.insert(projectPaths, prefix .. "/" .. desc:GetFullName():gsub("^.-ReplicatedStorage%.", "RS."):gsub("^.-ServerScriptService%.", "SSS."))
		end
	end
end
local shared = ReplicatedStorage:FindFirstChild("Shared")
if shared then collectConfigs(shared, "RS.Shared") end
local client = ReplicatedStorage:FindFirstChild("Client")
if client then collectConfigs(client, "RS.Client") end
local server = ServerScriptService:FindFirstChild("Server")
if server then collectConfigs(server, "SSS.Server") end

local config = {
	testMatch = { "**/*.spec" },
	mockDataModel = true,
}

local tJest0 = os.clock()
local runOk, runResult = pcall(function()
	return Jest.runCLI(script, config, projects):expect()
end)
local jestMs = math.floor((os.clock() - tJest0) * 1000)

local function summarize(res: any): any
	if type(res) ~= "table" then return nil end
	local r = res.results or res
	local suites = {}
	if r.testResults then
		for _, s in r.testResults do
			table.insert(suites, {
				testFilePath = tostring(s.testFilePath),
				failureMessage = s.failureMessage,
				numFailingTests = s.numFailingTests,
				numPassingTests = s.numPassingTests,
				numPendingTests = s.numPendingTests,
				testExecError = s.testExecError and {
					message = s.testExecError.message,
					stack = s.testExecError.stack,
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

local payload = {
	phase = "2b",
	package = "friends",
	materializeMs = materializeMs,
	cloneCount = cloneCount,
	jestMs = jestMs,
	ok = runOk,
	summary = if runOk then summarize(runResult) else nil,
	error = if not runOk then tostring(runResult) else nil,
	projectPaths = projectPaths,
}

return HttpService:JSONEncode(payload)
