import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isPlainObject, isString } from "./type-guards.ts";

/** Which terminal runtime hosts this extension's subagent panes. */
export type SurfaceRuntime = "herdr" | "hc";

/**
 * `auto` lets the fork decide once, on first use, from configuration,
 * environment evidence, and installed binaries. An explicit value pins the
 * runtime and skips detection entirely.
 */
export type SurfaceRuntimePreference = "auto" | SurfaceRuntime;

export interface SurfaceConfig {
	runtime: SurfaceRuntimePreference;
}

const DEFAULT_SURFACE_CONFIG: SurfaceConfig = { runtime: "auto" };

function invalidSurfaceConfig(source: string, message: string): never {
	throw new Error(`Invalid subagent surface config in ${source}: ${message}`);
}

export function parseSurfaceConfig(
	rawConfig: any,
	source = "config.json",
): SurfaceConfig {
	if (!isPlainObject(rawConfig)) {
		invalidSurfaceConfig(source, "root must be an object");
	}
	if (!Object.hasOwn(rawConfig, "surface")) {
		return { ...DEFAULT_SURFACE_CONFIG };
	}
	const surface = rawConfig.surface;
	if (!isPlainObject(surface)) {
		invalidSurfaceConfig(source, "surface must be an object");
	}
	const unsupportedKeys = Object.keys(surface).filter(
		(key) => key !== "runtime",
	);
	if (unsupportedKeys.length > 0) {
		invalidSurfaceConfig(
			source,
			`surface has unsupported key(s): ${unsupportedKeys.join(", ")}`,
		);
	}
	if (!Object.hasOwn(surface, "runtime")) {
		return { ...DEFAULT_SURFACE_CONFIG };
	}
	const runtime = surface.runtime;
	if (
		!isString(runtime) ||
		(runtime !== "auto" && runtime !== "herdr" && runtime !== "hc")
	) {
		invalidSurfaceConfig(
			source,
			'surface.runtime must be "auto", "herdr", or "hc"',
		);
	}
	return { runtime };
}

interface SurfaceConfigSource {
	sourcePath: string;
	rawConfig: string;
}

function readSurfaceConfigFile(
	configPath: string,
	examplePath: string,
): SurfaceConfigSource {
	try {
		return {
			sourcePath: configPath,
			rawConfig: readFileSync(configPath, "utf8"),
		};
	} catch (error) {
		// SAFETY: readFileSync only throws Node fs errors here, which carry code.
		const errno = error as NodeJS.ErrnoException;
		if (errno.code !== "ENOENT") throw error;
	}

	try {
		return {
			sourcePath: examplePath,
			rawConfig: readFileSync(examplePath, "utf8"),
		};
	} catch (error) {
		// SAFETY: see the preceding readFileSync error handling.
		const errno = error as NodeJS.ErrnoException;
		if (errno.code === "ENOENT") {
			throw new Error(
				`Missing subagent surface config. Expected ${configPath} or ${examplePath}.`,
			);
		}
		throw error;
	}
}

export function loadSurfaceConfig(
	configDir: string,
	examplePath: string,
): SurfaceConfig {
	const configPath = join(configDir, "config.json");
	const { sourcePath, rawConfig } = readSurfaceConfigFile(
		configPath,
		examplePath,
	);
	let parsed;
	try {
		parsed = JSON.parse(rawConfig);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid JSON in subagent config ${sourcePath}: ${detail}`);
	}
	return parseSurfaceConfig(parsed, sourcePath);
}
