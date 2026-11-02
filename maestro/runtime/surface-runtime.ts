import { accessSync, constants, existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { loadPaneConfig, type PaneConfig } from "../core/config/pane-config.ts";
import {
	loadSurfaceConfig,
	type SurfaceRuntime,
	type SurfaceRuntimePreference,
} from "../core/config/surface-config.ts";
import type { SurfaceProvider } from "../core/surface-provider.ts";
import { HerdrSurfaceProvider } from "../surfaces/herdr/herdr-surface-provider.ts";
import { HcSurfaceProvider } from "../surfaces/hc/hc-surface-provider.ts";

/**
 * Where the runtime choice came from. Reported so an operator can tell a
 * deliberate configuration from a lucky guess.
 */
export type SurfaceRuntimeSource =
	| "config"
	| "environment"
	| "probe"
	| "fallback";

export interface SurfaceRuntimeDecision {
	runtime: SurfaceRuntime;
	preference: SurfaceRuntimePreference;
	source: SurfaceRuntimeSource;
	reason: string;
}

export interface SurfaceRuntimeEnvironment {
	hcTerminalId?: string;
	herdrEnv?: string;
	termProgram?: string;
	herdrSocketPath?: string;
	pathDirectories: string[];
}

export function readSurfaceRuntimeEnvironment(
	env: NodeJS.ProcessEnv = process.env,
): SurfaceRuntimeEnvironment {
	const hcTerminalId = env.HC_TERMINAL_ID?.trim();
	const herdrEnv = env.HERDR_ENV?.trim();
	const termProgram = env.TERM_PROGRAM?.trim();
	const herdrSocketPath = env.HERDR_SOCKET_PATH?.trim();
	const result: SurfaceRuntimeEnvironment = {
		pathDirectories: (env.PATH ?? "").split(delimiter).filter(Boolean),
	};
	if (hcTerminalId) result.hcTerminalId = hcTerminalId;
	if (herdrEnv) result.herdrEnv = herdrEnv;
	if (termProgram) result.termProgram = termProgram;
	if (herdrSocketPath) result.herdrSocketPath = herdrSocketPath;
	return result;
}

export function executableOnPath(
	name: string,
	directories: readonly string[],
): boolean {
	return directories.some((directory) => {
		try {
			const path = join(directory, name);
			accessSync(path, constants.X_OK);
			return statSync(path).isFile();
		} catch {
			return false;
		}
	});
}

function herdrServerSocket(
	environment: SurfaceRuntimeEnvironment,
	home = process.env.HOME,
): string | undefined {
	if (environment.herdrSocketPath) return environment.herdrSocketPath;
	if (!home) return undefined;
	return join(home, ".config", "herdr", "herdr.sock");
}

function herdrServerRunning(
	environment: SurfaceRuntimeEnvironment,
	home = process.env.HOME,
): boolean {
	const socket = herdrServerSocket(environment, home);
	return socket !== undefined && existsSync(socket);
}

/**
 * The one decision this fork adds.
 *
 * Order is deliberate:
 *
 * 1. An explicit `surface.runtime` always wins: it is the only way to resolve
 *    a genuinely nested setup (a herdr pane running pi inside an hc terminal).
 * 2. Runtime environment evidence outranks binary probing, because a child
 *    pane must be created in the same runtime this process is already living
 *    in. `HERDR_ENV=1`/`TERM_PROGRAM=herdr` wins over `HC_TERMINAL_ID` so a
 *    herdr user's behaviour never changes without them asking for it.
 * 3. Probing only decides between runtimes that are actually installed, and a
 *    running herdr server outranks an installed `hc` binary so an existing
 *    herdr session keeps hosting its own panes.
 * 4. Falling back to `herdr` preserves the pre-fork behaviour, including the
 *    setup hint that tells the user what to install.
 */
export function decideSurfaceRuntime(
	preference: SurfaceRuntimePreference,
	environment: SurfaceRuntimeEnvironment,
	home?: string,
): SurfaceRuntimeDecision {
	if (preference !== "auto") {
		return {
			runtime: preference,
			preference,
			source: "config",
			reason: `surface.runtime is pinned to "${preference}"`,
		};
	}

	if (environment.herdrEnv === "1" || environment.termProgram === "herdr") {
		const nested = environment.hcTerminalId
			? `; HC_TERMINAL_ID=${environment.hcTerminalId} is also set, pin surface.runtime to "hc" to treat that as the innermost runtime`
			: "";
		return {
			runtime: "herdr",
			preference,
			source: "environment",
			reason: `running inside herdr (${environment.herdrEnv === "1" ? "HERDR_ENV=1" : `TERM_PROGRAM=${environment.termProgram}`})${nested}`,
		};
	}

	if (environment.hcTerminalId) {
		return {
			runtime: "hc",
			preference,
			source: "environment",
			reason: `running inside an hc terminal (HC_TERMINAL_ID=${environment.hcTerminalId})`,
		};
	}

	if (herdrServerRunning(environment, home)) {
		const socket = herdrServerSocket(environment, home) ?? "";
		return {
			runtime: "herdr",
			preference,
			source: "probe",
			reason: `a herdr server socket is live at ${socket}`,
		};
	}

	if (executableOnPath("hc", environment.pathDirectories)) {
		return {
			runtime: "hc",
			preference,
			source: "probe",
			reason: "no herdr server is running and an hc binary is on PATH",
		};
	}

	if (executableOnPath("herdr", environment.pathDirectories)) {
		return {
			runtime: "herdr",
			preference,
			source: "probe",
			reason: "no hc binary is on PATH and a herdr binary is",
		};
	}

	return {
		runtime: "herdr",
		preference,
		source: "fallback",
		reason:
			"no surface runtime evidence or installed binary; keeping the herdr default",
	};
}

let decided: SurfaceRuntimeDecision | undefined;

/**
 * Decide once per process. Probing hits the filesystem and PATH, and the
 * answer cannot change while this process lives, so repeated calls return the
 * first decision verbatim.
 */
export function resolveSurfaceRuntime(
	preference: SurfaceRuntimePreference,
	environment: SurfaceRuntimeEnvironment = readSurfaceRuntimeEnvironment(),
	home = process.env.HOME,
): SurfaceRuntimeDecision {
	if (decided) return decided;
	decided = decideSurfaceRuntime(preference, environment, home);
	return decided;
}

/** Test-only: forget the memoized decision so a new environment can be probed. */
export function resetSurfaceRuntimeDecision(): void {
	decided = undefined;
}

export function describeSurfaceRuntime(
	decision: SurfaceRuntimeDecision,
): string {
	return `surface runtime: ${decision.runtime} (${decision.source}) - ${decision.reason}`;
}

export interface SurfaceProviderOptions {
	configDir: string;
	configExamplePath: string;
}

export function createSurfaceProvider(
	options: SurfaceProviderOptions,
): SurfaceProvider {
	const config = loadSurfaceConfig(
		options.configDir,
		options.configExamplePath,
	);
	const paneConfig = loadPaneConfig(
		options.configDir,
		options.configExamplePath,
	);
	const decision = resolveSurfaceRuntime(config.runtime);
	return decision.runtime === "hc"
		? new HcSurfaceProvider({ paneConfig })
		: new HerdrSurfaceProvider({ paneConfig });
}

/**
 * Reuses an already loaded pane config, so the launch-operations path builds a
 * provider that agrees with the one the session already owns.
 */
export function createSurfaceProviderForPaneConfig(
	paneConfig: PaneConfig,
	options: SurfaceProviderOptions,
): SurfaceProvider {
	const config = loadSurfaceConfig(
		options.configDir,
		options.configExamplePath,
	);
	const decision = resolveSurfaceRuntime(config.runtime);
	return decision.runtime === "hc"
		? new HcSurfaceProvider({ paneConfig })
		: new HerdrSurfaceProvider({ paneConfig });
}
