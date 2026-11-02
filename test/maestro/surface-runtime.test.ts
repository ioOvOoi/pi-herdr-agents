import "../isolated-agent-dir.ts";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	decideSurfaceRuntime,
	readSurfaceRuntimeEnvironment,
	resetSurfaceRuntimeDecision,
	resolveSurfaceRuntime,
	type SurfaceRuntimeEnvironment,
} from "../../maestro/runtime/surface-runtime.ts";
import { parseSurfaceConfig } from "../../maestro/core/config/surface-config.ts";
import { sanitizeHcName } from "../../maestro/surfaces/hc/hc-cli.ts";
import { normalizeHcKeys } from "../../maestro/surfaces/hc/hc-surface-provider.ts";

function environment(
	overrides: Partial<SurfaceRuntimeEnvironment> = {},
): SurfaceRuntimeEnvironment {
	return { pathDirectories: [], ...overrides };
}

describe("surface runtime decision", () => {
	it("uses an explicit surface.runtime before any evidence", () => {
		const pinnedHc = decideSurfaceRuntime(
			"hc",
			environment({ herdrEnv: "1", termProgram: "herdr" }),
		);
		assert.equal(pinnedHc.runtime, "hc");
		assert.equal(pinnedHc.source, "config");

		const pinnedHerdr = decideSurfaceRuntime(
			"herdr",
			environment({ hcTerminalId: "t7" }),
		);
		assert.equal(pinnedHerdr.runtime, "herdr");
		assert.equal(pinnedHerdr.source, "config");
	});

	it("treats HERDR_ENV=1 as living inside herdr", () => {
		const decision = decideSurfaceRuntime(
			"auto",
			environment({ herdrEnv: "1", hcTerminalId: "t7" }),
		);
		assert.equal(decision.runtime, "herdr");
		assert.equal(decision.source, "environment");
		// A nested hc terminal is visible, so the reason must tell the operator
		// how to override the compatibility default.
		assert.match(decision.reason, /pin surface\.runtime to "hc"/);
	});

	it("treats TERM_PROGRAM=herdr as living inside herdr", () => {
		const decision = decideSurfaceRuntime(
			"auto",
			environment({ termProgram: "herdr" }),
		);
		assert.equal(decision.runtime, "herdr");
		assert.equal(decision.source, "environment");
	});

	it("selects hc when only HC_TERMINAL_ID marks the runtime", () => {
		const decision = decideSurfaceRuntime(
			"auto",
			environment({ hcTerminalId: "t7" }),
			"/nonexistent-home",
		);
		assert.equal(decision.runtime, "hc");
		assert.equal(decision.source, "environment");
		assert.match(decision.reason, /HC_TERMINAL_ID=t7/);
	});

	it("prefers a live herdr socket over an installed hc binary", () => {
		const decision = decideSurfaceRuntime(
			"auto",
			environment({
				pathDirectories: [process.env.PATH ?? ""],
				// Any existing path stands in for the socket: the probe only asks
				// whether the server's socket is there.
				herdrSocketPath: process.execPath,
			}),
			"/nonexistent-home",
		);
		assert.equal(decision.runtime, "herdr");
		assert.equal(decision.source, "probe");
		assert.match(decision.reason, /socket is live/);
	});

	it("selects hc when nothing is running but an hc binary is installed", () => {
		const bin = mkdtempSync(join(tmpdir(), "surface-runtime-"));
		const fakeHc = join(bin, "hc");
		writeFileSync(fakeHc, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
		try {
			const decision = decideSurfaceRuntime(
				"auto",
				environment({
					pathDirectories: [bin],
					herdrSocketPath: join(bin, "absent.sock"),
				}),
				"/nonexistent-home",
			);
			assert.equal(decision.runtime, "hc");
			assert.equal(decision.source, "probe");
			assert.match(decision.reason, /hc binary is on PATH/);
		} finally {
			rmSync(bin, { recursive: true, force: true });
		}
	});

	it("falls back to herdr, with the setup hint path, when nothing is present", () => {
		const decision = decideSurfaceRuntime(
			"auto",
			environment(),
			"/nonexistent-home",
		);
		assert.equal(decision.runtime, "herdr");
		assert.equal(decision.source, "fallback");
	});
});

describe("surface runtime memoization", () => {
	it("decides once and returns the first answer for later environments", () => {
		resetSurfaceRuntimeDecision();
		const first = resolveSurfaceRuntime(
			"auto",
			environment({ herdrEnv: "1" }),
			"/nonexistent-home",
		);
		assert.equal(first.runtime, "herdr");
		const second = resolveSurfaceRuntime(
			"hc",
			environment({ hcTerminalId: "t7" }),
			"/nonexistent-home",
		);
		assert.equal(second, first);
		resetSurfaceRuntimeDecision();
	});

	it("reads only the environment keys it understands", () => {
		const env = readSurfaceRuntimeEnvironment({
			HC_TERMINAL_ID: " t7 ",
			HERDR_ENV: "1",
			TERM_PROGRAM: "herdr",
			HERDR_SOCKET_PATH: "/tmp/sock",
			PATH: "/a:/b",
		});
		assert.equal(env.hcTerminalId, "t7");
		assert.equal(env.herdrEnv, "1");
		assert.equal(env.termProgram, "herdr");
		assert.equal(env.herdrSocketPath, "/tmp/sock");
		assert.deepEqual(env.pathDirectories, ["/a", "/b"]);
	});
});

describe("surface config parsing", () => {
	it("defaults to auto when the surface block is absent", () => {
		assert.deepEqual(parseSurfaceConfig({}), { runtime: "auto" });
	});

	it("accepts every documented value", () => {
		assert.deepEqual(parseSurfaceConfig({ surface: { runtime: "auto" } }), {
			runtime: "auto",
		});
		assert.deepEqual(parseSurfaceConfig({ surface: { runtime: "herdr" } }), {
			runtime: "herdr",
		});
		assert.deepEqual(parseSurfaceConfig({ surface: { runtime: "hc" } }), {
			runtime: "hc",
		});
	});

	it("rejects unknown runtimes and unknown keys", () => {
		assert.throws(
			() => parseSurfaceConfig({ surface: { runtime: "tmux" } }),
			/surface\.runtime must be/,
		);
		assert.throws(
			() => parseSurfaceConfig({ surface: { runtime: "auto", extra: 1 } }),
			/surface has unsupported key/,
		);
		assert.throws(
			() => parseSurfaceConfig({ surface: "hc" }),
			/must be an object/,
		);
	});
});

describe("hc CLI helpers", () => {
	it("normalises subagent names into hc's name grammar", () => {
		assert.equal(sanitizeHcName("login-api"), "login-api");
		assert.equal(sanitizeHcName("Fix Title!"), "fix-title");
		assert.equal(sanitizeHcName("___"), "___");
		assert.equal(sanitizeHcName("!!!"), "pane");
		assert.equal(sanitizeHcName("a".repeat(40)).length, 32);
	});

	it("translates herdr key chords into hc key names", () => {
		assert.deepEqual(normalizeHcKeys("C-c"), ["ctrl+c"]);
		assert.deepEqual(normalizeHcKeys("Enter"), ["enter"]);
		assert.deepEqual(normalizeHcKeys("Escape"), ["esc"]);
		assert.deepEqual(normalizeHcKeys("C-c C-c"), ["ctrl+c", "ctrl+c"]);
	});
});
