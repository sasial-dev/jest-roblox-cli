#!/usr/bin/env node
// Spike runner: uploads spike-mega.flat.rbxl and invokes a task script
// directly against Open Cloud Luau Execution. Does NOT use jest-roblox-cli.
//
// Usage: node spike-staged/run.mjs --task tasks/phase2a.luau
// Requires env: ROBLOX_OPEN_CLOUD_API_KEY, ROBLOX_UNIVERSE_ID, ROBLOX_PLACE_ID
// (load from ../../.env via node --env-file=../../.env)

import { parseArgs } from "node:util";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const BASE_URL = "https://apis.roblox.com";
const PLACE_FILE = "spike-staged/spike-mega.flat.rbxl";
const TIMEOUT_SECONDS = 120;
const POLL_INTERVAL_MS = 2000;

const { values } = parseArgs({
	options: {
		task: { type: "string" },
		place: { type: "string", default: PLACE_FILE },
		timeout: { type: "string", default: String(TIMEOUT_SECONDS) },
		envFile: { type: "string" },
	},
});

if (values.envFile) {
	const raw = fs.readFileSync(values.envFile, "utf8");
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq < 0) continue;
		let key = trimmed.slice(0, eq).trim();
		if (key.startsWith("export ")) key = key.slice(7).trim();
		let val = trimmed.slice(eq + 1).trim();
		if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
			val = val.slice(1, -1);
		}
		process.env[key] = val;
	}
	console.error(`loaded env from ${values.envFile}`);
}

if (!values.task) {
	console.error("usage: run.mjs --task <path-to-luau-task> [--place <rbxl>] [--timeout <seconds>]");
	process.exit(2);
}

const apiKey = process.env.ROBLOX_OPEN_CLOUD_API_KEY;
const universeId = process.env.ROBLOX_UNIVERSE_ID;
const placeId = process.env.ROBLOX_PLACE_ID;
if (!apiKey || !universeId || !placeId) {
	console.error("missing env: ROBLOX_OPEN_CLOUD_API_KEY / ROBLOX_UNIVERSE_ID / ROBLOX_PLACE_ID");
	process.exit(2);
}

const timeoutSeconds = Number(values.timeout);

const taskScript = fs.readFileSync(values.task, "utf8");
const placeBytes = fs.readFileSync(values.place);
console.error(`loaded task script (${taskScript.length} bytes) + place file (${placeBytes.length} bytes)`);

async function uploadPlace() {
	const url = `${BASE_URL}/universes/v1/${universeId}/places/${placeId}/versions?versionType=Saved`;
	const t0 = Date.now();
	const res = await fetch(url, {
		method: "POST",
		headers: {
			"x-api-key": apiKey,
			"Content-Type": "application/octet-stream",
		},
		body: placeBytes,
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`upload failed ${res.status}: ${body}`);
	}
	const body = await res.json();
	console.error(`uploaded place in ${Date.now() - t0}ms (versionNumber=${body.versionNumber})`);
	return body;
}

async function createTask() {
	const url = `${BASE_URL}/cloud/v2/universes/${universeId}/places/${placeId}/luau-execution-session-tasks`;
	const res = await fetch(url, {
		method: "POST",
		headers: {
			"x-api-key": apiKey,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			script: taskScript,
			timeout: `${timeoutSeconds}s`,
		}),
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`task create failed ${res.status}: ${body}`);
	}
	const body = await res.json();
	console.error(`created task ${body.path}`);
	return body.path;
}

async function pollTask(taskPath) {
	const url = `${BASE_URL}/cloud/v2/${taskPath}`;
	const deadline = Date.now() + timeoutSeconds * 1000 + 30_000; // grace
	while (Date.now() < deadline) {
		const res = await fetch(url, {
			headers: { "x-api-key": apiKey },
		});
		if (res.status === 429) {
			const retry = Number(res.headers.get("retry-after") ?? 5);
			console.error(`429, sleeping ${retry}s`);
			await new Promise((r) => setTimeout(r, retry * 1000));
			continue;
		}
		if (!res.ok) {
			const body = await res.text();
			throw new Error(`poll failed ${res.status}: ${body}`);
		}
		const body = await res.json();
		if (body.state === "COMPLETE" || body.state === "FAILED" || body.state === "CANCELLED") {
			return body;
		}
		process.stderr.write(".");
		await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
	}
	throw new Error("deadline exceeded");
}

const runStart = Date.now();
try {
	await uploadPlace();
	const taskPath = await createTask();
	const result = await pollTask(taskPath);
	console.error(`\nfinished in ${Date.now() - runStart}ms, state=${result.state}`);
	console.log(JSON.stringify(result, null, 2));
	if (result.state !== "COMPLETE") {
		process.exit(1);
	}
} catch (err) {
	console.error(`\nspike run failed: ${err.message}`);
	process.exit(1);
}
