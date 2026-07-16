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

// The dPLaaX attribute + rule collectors module wiring for
// @o3co/auth.policy-verifier.server. A consumer's main.mts registers
// this module alongside the framework's builtinCollectorsModule. The
// individual collector classes and config types are also exported so
// downstream code can construct or assert against them directly.

export { dplaaxModule } from "./module.mjs";

export {
	ATTR_SUBJECT_DID,
	ATTR_SUBSCRIBER_DID,
	ATTR_SUBJECT_DID_TYPE,
} from "./keys.mjs";

export { SubjectDidCollector } from "./collectors/SubjectDidCollector.mjs";
export { SubscriberDidCollector } from "./collectors/SubscriberDidCollector.mjs";
export {
	DID_TYPES,
	type DIDType,
	parseDIDType,
	SubjectDidTypeCollector,
} from "./collectors/SubjectDidTypeCollector.mjs";

export {
	DefaultDenyRuleCollector,
	type DefaultDenyRuleCollectorConfig,
} from "./rules/DefaultDenyRuleCollector.mjs";
export {
	SubjectDidTypeRuleCollector,
	type SubjectDidTypeRuleCollectorConfig,
} from "./rules/SubjectDidTypeRuleCollector.mjs";
export {
	SubscriberIdentityCheckRuleCollector,
	type SubscriberIdentityCheckRuleCollectorConfig,
} from "./rules/SubscriberIdentityCheckRuleCollector.mjs";
