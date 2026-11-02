import { execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { isPlainObject, isString } from "../../core/config/type-guards.ts";

/** `hc` is a CLI over a Unix socket; anything slower than this is a hung core. */
export const HC_RPC_TIMEOUT_MS = 10_000;
/** Screens and history can be megabytes; keep headroom over the herdr limit. */
export const HC_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * herdr-core is a separate binary from the herdr TUI. It installs as `hc`.
 */
export function isHcAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
	const directories = (env.PATH ?? "").split(delimiter).filter(Boolean);
	return directories.some((directory) => {
		try {
			const path = join(directory, "hc");
			accessSync(path, constants.X_OK);
			return statSync(path).isFile();
		} catch {
			return false;
		}
	});
}

export function parseHcJson(value: string): any {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

export interface HcExecOptions {
	timeoutMs?: number;
}

/**
 * hc prints JSON to stdout and diagnostics to stderr. Nothing here goes
 * through a shell: every argument is passed as its own argv entry, so a pane
 * name or a typed command can never be reinterpreted as shell syntax.
 *
 * `--json` is a global flag and must precede the subcommand (`hc --json ls`),
 * not follow it.
 */
export function hcExecAsync(
	args: string[],
	options: HcExecOptions = {},
): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			"hc",
			args,
			{
				encoding: "utf8",
				timeout: options.timeoutMs ?? HC_RPC_TIMEOUT_MS,
				maxBuffer: HC_OUTPUT_BYTES,
				killSignal: "SIGKILL",
			},
			(error, stdout) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(stdout);
			},
		);
	});
}

export class HcError extends Error {
	readonly kind: string | undefined;

	constructor(message: string, kind?: string) {
		super(message);
		this.name = "HcError";
		this.kind = kind;
	}
}

/** Run one `hc --json <subcommand>` call and unwrap either a result or an error. */
export async function hcJsonAsync(
	args: string[],
	options: HcExecOptions = {},
): Promise<any> {
	const output = await hcExecAsync(["--json", ...args], options);
	const parsed = parseHcJson(output);
	if (parsed === null) {
		throw new HcError(`hc ${args.join(" ")} returned non-JSON output`);
	}
	const error = parsed?.error;
	if (isPlainObject(error)) {
		const kind = isString(error.kind) ? error.kind : undefined;
		const message = isString(error.message)
			? error.message
			: `hc ${args.join(" ")} failed`;
		throw new HcError(message, kind);
	}
	return parsed;
}

/**
 * hc names are 1-32 characters of `a-z 0-9 - _ .`. Subagent names are already
 * close, but a caller is free to pass anything, so normalise instead of
 * letting the core reject the launch.
 */
export function sanitizeHcName(name: string): string {
	const cleaned = name
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 32);
	return cleaned.length > 0 ? cleaned : "pane";
}
