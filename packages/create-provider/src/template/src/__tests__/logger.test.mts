import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createAppLogger } from "../logger.mjs";

const original = process.env.LOG_LEVEL;
afterEach(() => {
	if (original === undefined) delete process.env.LOG_LEVEL;
	else process.env.LOG_LEVEL = original;
});

async function firstLine(write: (logger: ReturnType<typeof createAppLogger>) => void, level?: string) {
	const stream = new PassThrough();
	const chunks: string[] = [];
	stream.on("data", (c: Buffer) => chunks.push(c.toString()));
	write(createAppLogger("auth-provider", level, stream));
	await new Promise((resolve) => setImmediate(resolve));
	return JSON.parse(chunks.join("").trim());
}

describe("createAppLogger", () => {
	it("defaults to info", () => {
		delete process.env.LOG_LEVEL;
		expect(createAppLogger("auth-provider").level).toBe("info");
	});

	it("honours LOG_LEVEL when no level is passed", () => {
		process.env.LOG_LEVEL = "debug";
		expect(createAppLogger("auth-provider").level).toBe("debug");
	});

	it("prefers an explicit level (logging.level from config) over LOG_LEVEL", () => {
		process.env.LOG_LEVEL = "debug";
		expect(createAppLogger("auth-provider", "error").level).toBe("error");
	});

	it("emits NDJSON — one parseable object per line, named for the aggregator", async () => {
		const entry = await firstLine((l) => l.info("ready"), "info");
		expect(entry.msg).toBe("ready");
		expect(entry.name).toBe("auth-provider");
		expect(entry.level).toBe(30);
	});

	it("serialises an Error under `err` with its stack instead of `{}`", async () => {
		const entry = await firstLine((l) => l.error({ err: new Error("boom") }, "failed"), "info");
		expect(entry.err.message).toBe("boom");
		expect(typeof entry.err.stack).toBe("string");
	});
});
