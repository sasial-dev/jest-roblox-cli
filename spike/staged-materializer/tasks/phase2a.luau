--!strict
-- Phase 2a: verify spike-mega.flat.rbxl loads, __pkg_stage is intact, and
-- materializing friends-package moves its subtree into live services.
-- No Jest yet — this is a rbxl-load + materializer sanity check.

local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")
local ServerStorage = game:GetService("ServerStorage")

type Node = {
	name: string,
	class: string,
	children: { Node }?,
	truncated: boolean?,
}

local function snapshot(root: Instance, maxDepth: number): Node
	local function walk(inst: Instance, depth: number): Node
		if depth > maxDepth then
			return { name = inst.Name, class = inst.ClassName, truncated = true }
		end
		local kids: { Node } = {}
		for _, c in inst:GetChildren() do
			table.insert(kids, walk(c, depth + 1))
		end
		return { name = inst.Name, class = inst.ClassName, children = kids }
	end
	return walk(root, 0)
end

local function countDescendants(root: Instance): number
	return #root:GetDescendants()
end

local stage = ServerStorage:FindFirstChild("__pkg_stage")
assert(stage, "no ServerStorage.__pkg_stage — rbxl load problem")
local friends = stage:FindFirstChild("friends")
assert(friends, "no __pkg_stage.friends")

local before = {
	stagePackages = {},
	liveReplicatedStorage = snapshot(ReplicatedStorage, 2),
	liveServerScriptService = snapshot(ServerScriptService, 2),
}
for _, p in stage:GetChildren() do
	table.insert(before.stagePackages, {
		name = p.Name,
		class = p.ClassName,
		descendantCount = countDescendants(p),
	})
end

-- Materialize: for each top-level service-named folder inside the staged
-- package, clone its children into the live service of the same name.
local t0 = os.clock()
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
local materializeMs = math.floor((os.clock() - t0) * 1000)

local after = {
	liveReplicatedStorage = snapshot(ReplicatedStorage, 2),
	liveServerScriptService = snapshot(ServerScriptService, 2),
	cloneCount = cloneCount,
	materializeMs = materializeMs,
}

return HttpService:JSONEncode({
	phase = "2a",
	package = "friends",
	before = before,
	after = after,
})
