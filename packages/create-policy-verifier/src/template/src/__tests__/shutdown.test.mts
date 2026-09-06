import type { Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { deferExit, installGracefulShutdown, type Logger } from "../shutdown.mjs";

/** A `Server` double whose `close` callback fires only when we say so. */
function makeServer() {
    let closeCallback: ((err?: Error) => void) | undefined;
    const server = {
    	close: vi.fn((cb?: (err?: Error) => void) => {
    		closeCallback = cb;
    		return server;
    	}),
    	closeIdleConnections: vi.fn(),
    	closeAllConnections: vi.fn(),
    };
    return {
    	server: server as unknown as Server,
    	spies: server,
    	finishDraining: () => closeCallback?.(),
    	failClose: (err: Error) => closeCallback?.(err),
    };
}

const makeLogger = () => ({ info: vi.fn(), error: vi.fn() }) satisfies Logger;

function install(opts: { cleanup?: () => void | Promise<void>; drainTimeoutMs?: number } = {}) {
    const { server, spies, finishDraining, failClose } = makeServer();
    const logger = makeLogger();
    const exit = vi.fn();
    const signals = new Map<string, () => void>();
    installGracefulShutdown(server, {
    	logger,
    	cleanup: opts.cleanup ?? (() => {}),
    	...(opts.drainTimeoutMs === undefined ? {} : { drainTimeoutMs: opts.drainTimeoutMs }),
    	exit,
    	onSignal: (name, handler) => signals.set(name, handler),
    	offSignal: (name) => signals.delete(name),
    });
    return { spies, logger, exit, signals, finishDraining, failClose };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("installGracefulShutdown", () => {
    it("listens for both SIGTERM and SIGINT", () => {
    	expect([...install().signals.keys()].sort()).toEqual(["SIGINT", "SIGTERM"]);
    });

    it("stops accepting connections and releases idle keep-alive sockets", () => {
    	const { signals, spies } = install();
    	signals.get("SIGTERM")?.();
    	expect(spies.close).toHaveBeenCalledOnce();
    	expect(spies.closeIdleConnections).toHaveBeenCalledOnce();
    });

    it("runs cleanup once draining completes, then exits zero", async () => {
    	const cleanup = vi.fn();
    	const { signals, finishDraining, exit } = install({ cleanup });
    	signals.get("SIGTERM")?.();
    	expect(cleanup).not.toHaveBeenCalled();
    	finishDraining();
    	await settle();
    	expect(cleanup).toHaveBeenCalledOnce();
    	expect(exit).toHaveBeenCalledWith(0);
    });

    it("ignores a second signal instead of running cleanup twice", async () => {
    	const cleanup = vi.fn();
    	const { signals, spies, finishDraining, exit } = install({ cleanup });
    	const handler = signals.get("SIGTERM");
    	handler?.();
    	handler?.();
    	finishDraining();
    	await settle();
    	expect(spies.close).toHaveBeenCalledOnce();
    	expect(cleanup).toHaveBeenCalledOnce();
    	expect(exit).toHaveBeenCalledOnce();
    });

    it("forces the remaining connections closed when draining outruns the deadline", () => {
    	vi.useFakeTimers();
    	try {
    		const { signals, spies } = install({ drainTimeoutMs: 5_000 });
    		signals.get("SIGTERM")?.();
    		expect(spies.closeAllConnections).not.toHaveBeenCalled();
    		vi.advanceTimersByTime(5_000);
    		expect(spies.closeAllConnections).toHaveBeenCalledOnce();
    	} finally {
    		vi.useRealTimers();
    	}
    });

    it("exits non-zero on a forced close, so the drain outcome is visible", async () => {
    	vi.useFakeTimers();
    	let exitSpy: ReturnType<typeof vi.fn>;
    	try {
    		const { signals, exit } = install({ drainTimeoutMs: 5_000 });
    		exitSpy = exit;
    		signals.get("SIGTERM")?.();
    		vi.advanceTimersByTime(5_000);
    	} finally {
    		vi.useRealTimers();
    	}
    	await settle();
    	expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("does not force-close a drain that finished in time", () => {
    	vi.useFakeTimers();
    	try {
    		const { signals, spies, finishDraining } = install({ drainTimeoutMs: 5_000 });
    		signals.get("SIGTERM")?.();
    		finishDraining();
    		vi.advanceTimersByTime(10_000);
    		expect(spies.closeAllConnections).not.toHaveBeenCalled();
    	} finally {
    		vi.useRealTimers();
    	}
    });

    it("bounds cleanup so a hanging dispose cannot wedge the process", async () => {
    	vi.useFakeTimers();
    	try {
    		const { signals, finishDraining, exit, logger } = install({
    			cleanup: () => new Promise<void>(() => {}),
    			drainTimeoutMs: 5_000,
    		});
    		signals.get("SIGTERM")?.();
    		finishDraining();
    		await vi.advanceTimersByTimeAsync(5_000);
    		expect(logger.error).toHaveBeenCalledWith(
    			expect.objectContaining({ cleanupTimeoutMs: 5_000 }),
    			expect.stringContaining("cleanup timed out"),
    		);
    		expect(exit).toHaveBeenCalledWith(1);
    	} finally {
    		vi.useRealTimers();
    	}
    });

    it("reports a cleanup failure through the logger, not console, and exits non-zero", async () => {
    	const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    	const err = new Error("dispose failed");
    	const { signals, finishDraining, logger, exit } = install({ cleanup: () => Promise.reject(err) });
    	signals.get("SIGTERM")?.();
    	finishDraining();
    	await settle();
    	expect(logger.error).toHaveBeenCalledWith({ err }, expect.stringContaining("cleanup failed"));
    	expect(consoleError).not.toHaveBeenCalled();
    	expect(exit).toHaveBeenCalledWith(1);
    	consoleError.mockRestore();
    });

    it("reports the cleanup outcome as the reason and keeps the drain outcome under its own key", async () => {
    	const { signals, finishDraining, logger } = install({ cleanup: () => Promise.reject(new Error("x")) });
    	signals.get("SIGTERM")?.();
    	finishDraining();
    	await settle();
    	expect(logger.info).toHaveBeenCalledWith(
    		{ reason: "cleanup-failed", drain: "drained", exitCode: 1 },
    		"graceful shutdown: complete",
    	);
    });

    it("does not report a failed close as a clean drain", async () => {
    	const err = new Error("Server is not running");
    	const { signals, failClose, logger, exit } = install();
    	signals.get("SIGTERM")?.();
    	failClose(err);
    	await settle();
    	expect(logger.error).toHaveBeenCalledWith({ err }, expect.stringContaining("close failed"));
    	expect(exit).toHaveBeenCalledWith(1);
    });

    it("removes its own signal listeners once shutting down", () => {
    	const { signals } = install();
    	signals.get("SIGTERM")?.();
    	expect(signals.size).toBe(0);
    });

    it("defers the real exit a turn so pino's buffered destination can flush", async () => {
    	const exitProcess = vi.fn();
    	deferExit(3, exitProcess);
    	expect(exitProcess).not.toHaveBeenCalled();
    	await settle();
    	expect(exitProcess).toHaveBeenCalledWith(3);
    });
});
