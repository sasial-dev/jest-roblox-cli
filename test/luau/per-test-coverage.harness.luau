--!nocheck
-- Lute-driven test for the per-test coverage hook's orchestration: snapshot on
-- test_start, diff on test_done, read the matcher state for the test's identity.
-- The module under test is inlined into the placeholder below (with its
-- coverage-attribution dependency already inlined by the spec). The circus
-- addEventHandler and the Expect matcher state are faked, so no Roblox, no jest.
-- Any failed assertion calls error(), failing the wrapper spec.

local PerTestCoverage = __MODULE__

local function fail(message: string)
	error(message, 0)
end

local function check(condition: boolean, message: string)
	if not condition then
		fail(message)
	end
end

local function contains(list: { number }, value: number): boolean
	for _, element in list do
		if element == value then
			return true
		end
	end

	return false
end

local function makeInstance(name: string, parent: any): any
	return { Name = name, Parent = parent }
end

-- A service-rooted file: the topmost fake (Parent = nil) stands in for `game`
-- and is excluded from the path.
local function makeFakeFile(): any
	local root = makeInstance("game", nil)
	local replicatedStorage = makeInstance("ReplicatedStorage", root)
	local folder = makeInstance("Foo", replicatedStorage)

	return makeInstance("bar.spec", folder)
end

local function makeDispatcher()
	local handler: any
	local function addEventHandler(registered: any)
		handler = registered
	end

	local function dispatch(event: any)
		handler(nil, event)
	end

	return addEventHandler, dispatch
end

-- T1: a test that covers a statement records its file, name, and delta.
local function testRecordsCoverage()
	local addEventHandler, dispatch = makeDispatcher()
	local state = { currentTestName = "Foo > adds", testPath = makeFakeFile() }
	local cov = {}
	local records = PerTestCoverage.install(addEventHandler, function()
		return state
	end, function()
		return cov
	end)

	dispatch({ name = "test_start" })
	cov["out/m.luau"] = { s = { 1 } }
	dispatch({ name = "test_done" })

	check(#records == 1, "T1: one record produced")
	check(records[1].testFilePath == "ReplicatedStorage/Foo/bar.spec", "T1: service-rooted file path")
	check(records[1].testCaseId == "Foo > adds", "T1: full test name")
	check(contains(records[1].delta["out/m.luau"].s, 1), "T1: statement 1 attributed")
end

-- T2: a test that covers nothing new produces no record.
local function testDropsEmptyTest()
	local addEventHandler, dispatch = makeDispatcher()
	local state = { currentTestName = "Foo > noop", testPath = makeFakeFile() }
	local cov = { ["out/m.luau"] = { s = { 1 } } }
	local records = PerTestCoverage.install(addEventHandler, function()
		return state
	end, function()
		return cov
	end)

	dispatch({ name = "test_start" })
	-- nothing changes before test_done
	dispatch({ name = "test_done" })

	check(#records == 0, "T2: no record for a test that covered nothing")
end

-- T3: two sequential tests against a cumulative table each get their own delta.
local function testSequentialTests()
	local addEventHandler, dispatch = makeDispatcher()
	local state = { currentTestName = "first", testPath = makeFakeFile() }
	local cov = { ["out/m.luau"] = { s = { 0 } } }
	local records = PerTestCoverage.install(addEventHandler, function()
		return state
	end, function()
		return cov
	end)

	dispatch({ name = "test_start" })
	cov["out/m.luau"].s[1] = 1
	dispatch({ name = "test_done" })

	state.currentTestName = "second"
	dispatch({ name = "test_start" })
	cov["out/m.luau"].s[1] = 2
	dispatch({ name = "test_done" })

	check(#records == 2, "T3: a record per test")
	check(records[1].testCaseId == "first", "T3: first test recorded")
	check(records[2].testCaseId == "second", "T3: second test recorded")
end

-- T4: an error while reading the test identity must be swallowed — circus does
-- not guard event handlers, so a throw would break the whole coverage run.
local function testHandlerSwallowsErrors()
	local addEventHandler, dispatch = makeDispatcher()
	local cov = {}
	local records = PerTestCoverage.install(addEventHandler, function()
		error("matcher state unavailable")
	end, function()
		return cov
	end)

	dispatch({ name = "test_start" })
	cov["out/m.luau"] = { s = { 1 } }
	local ok = pcall(dispatch, { name = "test_done" })

	check(ok, "T4: a throwing identity lookup must not propagate out of the handler")
	check(#records == 0, "T4: nothing recorded when the identity is unavailable")
end

testRecordsCoverage()
testDropsEmptyTest()
testSequentialTests()
testHandlerSwallowsErrors()

print("ALL OK")
