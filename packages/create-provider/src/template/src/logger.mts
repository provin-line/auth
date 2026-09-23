/*
 * Copyright 2026 1o1 Co. Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { type DestinationStream, pino, stdSerializers } from "pino";

/**
 * The instance's logger: newline-delimited JSON on stdout, the shape every
 * log aggregator ingests without a parser.
 *
 * It used to come from `@o3co/auth.utils`, which took pino as an *optional*
 * peer and fell back to `console` when the import failed. The generator never
 * emitted pino, so every generated instance silently logged bare
 * `[auth-provider] …` lines. pino is a direct dependency now, and the level
 * honours `logging.level` from the application config with `LOG_LEVEL` as the
 * environment override.
 */
export function createAppLogger(
	name: string,
	level: string = process.env.LOG_LEVEL ?? "info",
	destination?: DestinationStream,
) {
	const options = {
		name,
		level,
		// `err` is pino's conventional key for an Error; without the serialiser
		// an Error stringifies to `{}` and the stack is lost where it is needed.
		serializers: { err: stdSerializers.err },
	};
	return destination ? pino(options, destination) : pino(options);
}
