local fs = require("@lune/fs")
local roblox = require("@lune/roblox")

local bytes = fs.readFile("spike-staged/spike-mega.rbxl")
local game = roblox.deserializePlace(bytes)

local function walk(instance, depth, maxDepth)
	if depth > maxDepth then
		return
	end
	local indent = string.rep("  ", depth)
	print(indent .. instance.Name .. " [" .. instance.ClassName .. "]")
	for _, child in instance:GetChildren() do
		walk(child, depth + 1, maxDepth)
	end
end

print("=== Top level of deserialized place ===")
for _, service in game:GetChildren() do
	print(service.Name .. " [" .. service.ClassName .. "]")
end

print()
print("=== ServerStorage.__pkg_stage ===")
local stage = game:GetService("ServerStorage"):FindFirstChild("__pkg_stage")
if stage then
	walk(stage, 0, 3)
else
	print("NOT FOUND")
end
