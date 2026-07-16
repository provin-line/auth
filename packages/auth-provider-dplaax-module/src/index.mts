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

// dPLaaX composition layer for @o3co/auth-provider-* framework. A
// deployment's main.mts validates its parsed HOCON against
// DplaaxConfigSchema, then passes the result to buildModules() to
// produce the module list for @o3co/auth-provider-core's createApp.
// The individual building blocks (resolver classes, repository / keystore
// modules, validator helpers) are also exported so downstream code can
// override or assert against them directly.

export {
	buildModules,
	type DplaaxAppConfig,
	type DplaaxAppConfigBase,
	type DplaaxBuildModulesOverrides,
} from "./buildModules.mjs";

export {
	clientRepositoryModule,
	inMemoryCodeRepositoryModule,
	keyStoreModule,
} from "./modules.mjs";

export {
	DplaaxConfigSchema,
	type DplaaxConfigParsed,
} from "./config-schema.mjs";

export {
	DplaaxDidResolver,
	type DplaaxDidResolverOptions,
} from "./resolver/dplaax.mjs";

// did:dplaax grammar layer. The parser, classifier, and accountType
// allow-list live in @provin-line/did-dplaax — a zero-runtime-dep, framework-
// agnostic package shared with @provin-line/policy-verifier-dplaax-module
// (auth#19). Re-exported here so downstream consumers keep their existing
// import path; new consumers MAY import directly from @provin-line/did-dplaax.
export {
	classifyDplaaxDid,
	getSupportedAccountTypes,
	isSupportedAccountType,
	parseDplaaxDid,
	type ParsedDplaaxDid,
	requireKnownPattern,
	requireOwner,
	type SupportedAccountType,
	validateDplaaxDid,
} from "@provin-line/did-dplaax";
