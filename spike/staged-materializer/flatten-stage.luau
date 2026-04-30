-- Post-processes spike-mega.rbxl: flattens nested DataModel + Service
-- classes under ServerStorage.__pkg_stage.<pkg> into plain Folders so the
-- rbxl loads cleanly in Roblox. Children (the package's real Packages/
-- Shared/Client folders) are preserved.

local fs = require("@lune/fs")
local roblox = require("@lune/roblox")

local INPUT = "spike-staged/spike-mega.rbxl"
local OUTPUT = "spike-staged/spike-mega.flat.rbxl"

local bytes = fs.readFile(INPUT)
local game = roblox.deserializePlace(bytes)

local FLATTEN_CLASSES = {
	DataModel = true,
	ReplicatedStorage = true,
	ServerScriptService = true,
	ServerStorage = true,
	StarterPlayer = true,
	StarterPlayerScripts = true,
	Lighting = true,
	Workspace = true,
	SoundService = true,
}

local function replaceWithFolder(instance)
	local folder = roblox.Instance.new("Folder")
	folder.Name = instance.Name
	for _, child in instance:GetChildren() do
		child.Parent = folder
	end
	folder.Parent = instance.Parent
	instance:Destroy()
	return folder
end

local function flattenRecursive(instance)
	for _, child in instance:GetChildren() do
		local wasClass = child.ClassName
		if FLATTEN_CLASSES[wasClass] then
			local replaced = replaceWithFolder(child)
			print(string.format("flattened %s [%s] -> Folder", replaced.Name, wasClass))
			flattenRecursive(replaced)
		else
			flattenRecursive(child)
		end
	end
end

local stage = game:GetService("ServerStorage"):FindFirstChild("__pkg_stage")
assert(stage, "__pkg_stage not found")

for _, pkgNode in stage:GetChildren() do
	flattenRecursive(pkgNode)
	if FLATTEN_CLASSES[pkgNode.ClassName] then
		replaceWithFolder(pkgNode)
	end
end

print()
print("=== Flattened tree ===")
local function walk(inst, depth, maxDepth)
	if depth > maxDepth then return end
	print(string.rep("  ", depth) .. inst.Name .. " [" .. inst.ClassName .. "]")
	for _, c in inst:GetChildren() do
		walk(c, depth + 1, maxDepth)
	end
end
walk(game:GetService("ServerStorage"):FindFirstChild("__pkg_stage"), 0, 3)

local out = roblox.serializePlace(game)
fs.writeFile(OUTPUT, out)
print()
print("Wrote " .. OUTPUT)
