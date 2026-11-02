import type { PaneConfig } from "../../core/config/pane-config.ts";
import type {
	CreateSurfaceOptions,
	CreateWorktreeSurfaceOptions,
	ReportOpenedPrimaryWorkspaceInput,
	SurfaceInfo,
	SurfaceProcessInfo,
	SurfaceProvider,
	WorktreeSurface,
	WorktreeSurfaceInfo,
} from "../../core/surface-provider.ts";
import type { OpenedPrimaryWorkspaceReport } from "../../core/opened-primary-workspace.ts";
import type { PaneInspection, SurfaceHandle } from "../../core/types.ts";
import {
	isFiniteNumber,
	isPlainObject,
	isString,
} from "../../core/config/type-guards.ts";
import {
	hcJsonAsync,
	HcError,
	isHcAvailable,
	sanitizeHcName,
} from "./hc-cli.ts";

const READY_POLL_MS = 150;
const ABSENCE_POLL_MS = 200;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function terminalAddress(record: any): string | undefined {
	return isString(record?.address) ? record.address : undefined;
}

function terminalCwd(record: any): string | undefined {
	return isString(record?.cwd) ? record.cwd : undefined;
}

function terminalTitle(record: any): string | undefined {
	const labels = record?.labels;
	if (isPlainObject(labels) && isString(labels.title)) return labels.title;
	// `hc label <t> title=...` stores under the terminal's own label map; older
	// builds expose a flat `name` instead.
	if (isString(record?.name)) return record.name;
	return undefined;
}

function terminalStatus(
	record: any,
): "idle" | "working" | "blocked" | "done" | "unknown" {
	if (record?.foreground) return "working";
	if (record?.exit_code !== null && record?.exit_code !== undefined)
		return "done";
	if (record?.state === "live") return "idle";
	return "unknown";
}

/**
 * herdr's `sendKeys` takes tmux-style chords ("C-c", "Enter"); hc's `keys`
 * takes its own names ("ctrl+c", "enter"). Translate the small set the harness
 * actually uses and pass everything else through lowercased.
 */
const HC_KEY_ALIASES = new Map<string, string>([
	["enter", "enter"],
	["c-m", "enter"],
	["return", "enter"],
	["escape", "esc"],
	["esc", "esc"],
	["tab", "tab"],
	["c-c", "ctrl+c"],
	["c-d", "ctrl+d"],
	["c-z", "ctrl+z"],
	["up", "up"],
	["down", "down"],
	["left", "left"],
	["right", "right"],
	["backspace", "backspace"],
	["b-space", "backspace"],
	["space", "space"],
]);

export function normalizeHcKeys(keys: string): string[] {
	return keys
		.split(/\s+/)
		.filter(Boolean)
		.map((key) => {
			const lowered = key.toLowerCase();
			return HC_KEY_ALIASES.get(lowered) ?? lowered;
		});
}

/**
 * herdr-core (hc) surface provider.
 *
 * hc models a flat list of terminals rather than herdr's windows/tabs/panes.
 * A subagent pane is therefore a top-level terminal: `placement` and
 * `paneConfig.maxPerTab` have no CLI equivalent, and grouped/split layouts are
 * an app-side concern. Everything that needs herdr's workspace concept —
 * worktree provisioning, primary-workspace claims — is unsupported here and
 * says so instead of pretending.
 */
export class HcSurfaceProvider implements SurfaceProvider {
	readonly name = "hc";
	readonly paneConfig: PaneConfig;

	constructor(options: { paneConfig: PaneConfig }) {
		this.paneConfig = options.paneConfig;
	}

	isAvailable(): boolean {
		return isHcAvailable();
	}

	async createSurface(opts: CreateSurfaceOptions): Promise<string> {
		// No argv: hc starts that machine's own shell, which is what a subagent
		// pane needs before runCommand types into it.
		const args = ["run", "--bg", "--name", sanitizeHcName(opts.name)];
		if (opts.cwd) args.push("--cwd", opts.cwd);
		const result = await hcJsonAsync(args);
		const address = terminalAddress(result);
		if (!address) throw new HcError("hc run returned no terminal address");
		return address;
	}

	async runCommand(surfaceId: string, command: string): Promise<void> {
		await hcJsonAsync(["send", surfaceId, command]);
	}

	async readScreen(surfaceId: string, lines?: number): Promise<string> {
		const args = ["read", surfaceId];
		if (lines !== undefined) args.push("--lines", String(lines));
		const result = await hcJsonAsync(args);
		return isString(result?.text) ? result.text : "";
	}

	async closeSurface(surfaceId: string): Promise<void> {
		await hcJsonAsync(["kill", surfaceId]);
		try {
			await hcJsonAsync(["rm", surfaceId]);
		} catch {
			// A terminal that has not finished within the kill window stays listed;
			// the next reconcile pass removes it. Closing is already complete.
		}
	}

	async listSurfaces(opts?: { timeoutMs?: number }): Promise<SurfaceInfo[]> {
		const result = await hcJsonAsync(
			["ls"],
			opts?.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs },
		);
		const terminals = Array.isArray(result?.terminals) ? result.terminals : [];
		const surfaces: SurfaceInfo[] = [];
		for (const record of terminals) {
			const id = terminalAddress(record);
			if (!id) continue;
			const surface: SurfaceInfo = { id };
			const name = terminalTitle(record);
			if (name) surface.name = name;
			const cwd = terminalCwd(record);
			if (cwd) surface.cwd = cwd;
			surfaces.push(surface);
		}
		return surfaces;
	}

	attachSurface(id: string): SurfaceHandle {
		return {
			id,
			runCommand: (command) => this.runCommand(id, command),
			readScreen: (lines) => this.readScreen(id, lines),
			sendKeys: (keys) => this.sendKeys(id, keys),
			close: () => this.closeSurface(id),
		};
	}

	createWorktreeSurface(_opts: CreateWorktreeSurfaceOptions): WorktreeSurface {
		throw new HcError(
			"hc cannot provision worktree surfaces: herdr-core has no workspace concept. " +
				'Run subagents in the provider checkout, or pin surface.runtime to "herdr" for worktree isolation.',
		);
	}

	removeWorktreeSurface(_workspaceId: string): void {
		throw new HcError("hc never provisioned this worktree surface");
	}

	listWorktreeSurfaces(_opts?: {
		cwd?: string;
		timeoutMs?: number;
	}): Promise<WorktreeSurfaceInfo[]> {
		// Consistent with createWorktreeSurface: hc owns no worktrees, so there is
		// nothing to recover and nothing to clean up.
		return Promise.resolve([]);
	}

	reportOpenedPrimaryWorkspace(
		_input: ReportOpenedPrimaryWorkspaceInput,
	): OpenedPrimaryWorkspaceReport | undefined {
		return undefined;
	}

	setupHint(): string {
		return (
			"herdr-core (hc) is not installed. Install it from " +
			'https://github.com/herdrdev/herdr-core, or pin surface.runtime to "herdr".'
		);
	}

	runScript(
		_surfaceId: string,
		_command: string,
		_options: { scriptPath: string; scriptPreamble: string },
	): string {
		throw new HcError(
			"runScript is not implemented for hc yet: use runCommand, which sends the same text into the shell",
		);
	}

	async inspectSurface(surfaceId: string): Promise<PaneInspection> {
		let result: any;
		try {
			result = await hcJsonAsync(["get", surfaceId]);
		} catch (error) {
			const kind = error instanceof HcError ? error.kind : undefined;
			if (kind && /unknown|not_found/.test(kind)) {
				// SAFETY: the catch received a thrown value; HcError and every other
				// thrown value in this function carry a message.
				return { kind: "missing", error: (error as Error).message };
			}
			return {
				kind: "unavailable",
				error: error instanceof Error ? error.message : String(error),
			};
		}
		return {
			kind: "present",
			agentStatus: terminalStatus(result),
			observedAt: Date.now(),
		};
	}

	async sendKeys(surfaceId: string, keys: string): Promise<void> {
		const names = normalizeHcKeys(keys);
		if (names.length === 0) return;
		await hcJsonAsync(["keys", surfaceId, ...names]);
	}

	async getProcessInfo(surfaceId: string): Promise<SurfaceProcessInfo> {
		const result = await hcJsonAsync(["get", surfaceId]);
		const info: SurfaceProcessInfo = {
			pids: [],
			foregroundProcesses: [],
		};
		const foreground = result?.foreground;
		const pid = foreground?.pid ?? foreground?.process_id;
		if (isFiniteNumber(pid)) {
			info.pids = [pid];
			info.foregroundProcessGroupId = pid;
			const argv = Array.isArray(foreground?.argv)
				? foreground.argv
				: undefined;
			const process: SurfaceProcessInfo["foregroundProcesses"][number] = {
				pid,
			};
			if (isString(foreground?.name)) process.name = foreground.name;
			if (isString(foreground?.cwd)) process.cwd = foreground.cwd;
			if (argv) {
				process.argv = argv;
				if (isString(argv[0])) process.argv0 = argv[0];
			}
			info.foregroundProcesses = [process];
		}
		return info;
	}

	async waitForShellReady(
		surfaceId: string,
		opts?: { timeoutMs?: number },
	): Promise<void> {
		const deadline = Date.now() + (opts?.timeoutMs ?? 5_000);
		for (;;) {
			const inspection = await this.inspectSurface(surfaceId);
			if (inspection.kind === "present") return;
			if (Date.now() >= deadline) {
				throw new HcError(
					`hc terminal ${surfaceId} never became ready: ${inspection.kind === "unavailable" ? inspection.error : "missing"}`,
				);
			}
			await sleep(READY_POLL_MS);
		}
	}

	async waitForSurfaceAbsence(
		surfaceId: string,
		opts?: { timeoutMs?: number },
	): Promise<void> {
		const deadline = Date.now() + (opts?.timeoutMs ?? 5_000);
		for (;;) {
			const surfaces = await this.listSurfaces();
			if (!surfaces.some((surface) => surface.id === surfaceId)) return;
			if (Date.now() >= deadline) {
				throw new HcError(
					`hc terminal absence unconfirmed after ${opts?.timeoutMs ?? 5_000}ms: ${surfaceId}`,
				);
			}
			await sleep(ABSENCE_POLL_MS);
		}
	}

	focusWorkspace(_workspaceId: string): void {
		// hc has no workspaces to focus; the app owns layout and focus.
	}

	async setTitle(target: "tab" | "workspace", title: string): Promise<void> {
		// herdr renames "the current tab/workspace", which its CLI resolves from the
		// calling pane. hc has no such implicit target, so the terminal is read from
		// HC_TERMINAL_ID: outside an hc terminal there is nothing to rename.
		void target;
		const terminal = process.env.HC_TERMINAL_ID?.trim();
		if (!terminal) return;
		await hcJsonAsync(["label", terminal, `title=${title}`]);
	}
}
