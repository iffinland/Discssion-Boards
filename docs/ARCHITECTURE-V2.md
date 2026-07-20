# Discussion Boards Architecture V2

Status: **Design prerequisite for review**

This document defines the Architecture V2 state, authority, validation, and
migration model for Discussion Boards. It is the prerequisite deliverable for
GitHub issue #2 and must be reviewed before Phase 1 production implementation
begins.

No part of this document authorizes a production migration by itself.

## 1. Scope

Architecture V2 covers:

- authoritative Topic, Thread, and Post state;
- authenticated operations over those entities;
- QDN discovery, validation, reduction, and quarantine;
- compatibility with existing V1 QDN records;
- non-authoritative indexes and partial-data behavior;
- architectural boundaries for reactions, native polls, moderation, roles,
  tips, restricted access, and later scaling work.

It does not prescribe UI styling, dependency maintenance, release metadata, or
unrelated Qortium Home integration work. Those remain separate workflow items.

In V1, the application type named `SubTopic` is the forum thread. Architecture
V2 uses **Thread** as the canonical term. The legacy reader maps `SubTopic` to
`Thread`; V2 does not create a second nested entity between them.

## 2. Platform-evolution and verification policy

Qortium Core and Qortium Home are active projects. Commit hashes below record
what was inspected for this design; they are not permanently frozen capability
targets.

### 2.1 Reference state inspected

| Repository | Path | Verified commit |
| --- | --- | --- |
| Discussion Boards | this repository | `c3c9638da72e2ab529042cffd079d3e49be9fb51` |
| Qortium Core | `../../github-clones/qortium-core` | `c000a0cd4a1ebaaab5aa753f3cd199f3302ff5bf` |
| Qortium Home | `../../github-clones/qortium-home` | `a41e5f9678d7f20d7fb77a223c45fddc0096632e` |

The Discussion Boards production source reviewed by architecture issue #1
remains commit `f20f93c833ef74dc83a22a59be2d1c6682e96bde`.
The later Discussion Boards commit above adds this design document without
changing production source.

GitHub specification inspected:

- issue #1, architecture review;
- issue #2, Architecture V2 prerequisite and acceptance criteria;
- issue #3, Phase 1 ownership/state authorization;
- the dependent phased issue workflow through issue #14.

### 2.2 Three classes of platform statement

This document distinguishes:

1. **Application architectural invariants**: rules Discussion Boards must
   preserve even if bridge or Core APIs evolve.
2. **Currently verified capabilities**: behavior observed in the reference
   commits above.
3. **Phase-time implementation details**: payloads, response shapes, endpoints,
   fees, validation rules, limits, and availability that must be inspected
   again immediately before implementing the relevant phase.

An older GitHub observation remains useful historical context, but a newer
verified implementation takes precedence when describing current capability.
No future phase may rely only on this document's recorded API shape.

### 2.3 Re-verification gate

Before each migration phase:

1. record current Core and Home commits;
2. inspect the applicable Home action handler and action catalogue;
3. inspect the underlying Core API, transaction data, validation, and response
   types;
4. compare them with this document;
5. update this document or add a reviewed decision record if behavior changed;
6. implement only against the newly verified contract.

Core capability does not imply Home bridge availability.

## 3. Architectural invariants

The following are application invariants:

1. An entity ID does not establish ownership by itself.
2. Embedded `author`, `creator`, `actor`, `owner`, `wallet`, or role fields are
   claims, not trusted identity.
3. A QDN payload is evaluated together with its resource publisher and trusted
   Core metadata.
4. Only the canonical entity owner can change owner-controlled entity fields.
5. Moderation, reactions, votes, tips, and role changes cannot replace entity
   content.
6. Client timestamps are display metadata and never the sole ordering or
   authority source.
7. Authorization is evaluated before an operation participates in reduction.
8. Reduction is deterministic for the same complete input set.
9. Invalid or unauthorized records cannot silently become visible state.
10. Indexes are derived, rebuildable, and non-authoritative.
11. Missing data and incomplete discovery are not equivalent to deletion or an
    empty board.
12. Public, unencrypted QDN content is public even when the official UI limits
    access.
13. Existing V1 content remains readable unless a record is demonstrably
    malformed or unsafe to render.
14. V2 state cannot be overridden by a later V1 snapshot.
15. Platform write success is not application-state proof until the returned
    result is validated as required by the applicable phase.

## 4. V1 failure model

V1 publishes mutable whole-entity snapshots for topics, threads, and posts.
The current loader searches identifier prefixes, parses payloads, groups them
by embedded IDs, and selects the greatest payload `updatedAt`.

The current model has these failures:

- an unrelated publisher can reuse an embedded entity ID;
- a future client timestamp can win reduction;
- the publisher returned by QDN search is discarded after fetch;
- embedded author identities are not reducer-validated against the publisher;
- reactions and poll votes republish complete posts;
- moderation and deletion can republish complete entities under staff names;
- tips increment an unverifiable mutable counter;
- topic and thread indexes contain full mutable state and are selected by
  client timestamp;
- concurrent snapshot writers can lose each other's changes;
- fixed prefix-search limits can silently produce incomplete state;
- unavailable authoritative content can be confused with cached index content;
- delegated role writes can be published by identities the loader does not
  trust.

V1 UI permission checks improve user experience but do not secure shared state.
The reducer must enforce authority independently.

## 5. Canonical entities

### 5.1 Common entity properties

Every V2 entity creation record contains:

```ts
type EntityType = "topic" | "thread" | "post";

interface EntityCreateBody {
  entityType: EntityType;
  entityId: string;
  parentId: string | null;
  owner: {
    publisherName: string;
    walletAddress: string;
  };
  createdAt: string; // display only
  content: TopicCreateContent | ThreadCreateContent | PostCreateContent;
}
```

The reducer derives the authoritative publisher from the resource metadata.
`owner.publisherName` must match it after canonical name normalization.
`owner.walletAddress` is accepted only after the identity rule in section 10
is satisfied. Neither embedded value can supersede the resource publisher.

Creation metadata, entity type, entity ID, parent identity, and canonical owner
are immutable after canonical creation is selected.

### 5.2 Topic

Topic owner-controlled content:

- title;
- description;
- default access classification;
- allowed-address configuration;
- presentation sort preference.

Topic creation is additionally subject to the trusted role policy in force at
creation. Ownership and permission to create are distinct:

- authorization permits a user to create a Topic;
- the accepted creation publisher becomes that Topic's content owner;
- later loss of a staff role does not transfer ownership;
- staff moderation acts through moderation operations, not owner edits.

### 5.3 Thread

Thread creation contains:

- parent Topic ID;
- title and description/initial subject metadata;
- owner identity;
- creation display time;
- access configuration permitted by the parent Topic policy.

The Thread owner controls title/description and owner-selectable access fields.
Pin, lock, visibility, solved, and moderation audit fields are derived from
moderation operations, not owner snapshots.

Legacy `SubTopic` fields such as `lastPostAt` and `lastPostAuthorUserId` are
derived activity summaries, not authoritative Thread content in V2.

### 5.4 Post

Post creation contains:

- parent Thread ID;
- optional parent Post ID;
- content;
- attachment references;
- owner identity;
- creation display time;
- optional native poll reference created as part of the post workflow.

Likes, liker lists, tip counts, poll votes, pin state, and moderation state are
not Post entity fields in V2.

Post attachments are references to separately published QDN resources. Their
service, publisher, identifier, filename, media type, and size are claims that
must be validated before use. Large-file publication mechanics are deferred to
the bridge/large-file phase.

## 6. Application payload envelope

All V2 application records use this logical envelope:

```ts
interface QdbV2Payload<TBody> {
  schema: "qdb-v2";
  schemaVersion: 2;
  kind: "entity-create" | "operation" | "index";
  recordType: string;
  recordId: string;
  targetId: string | null;
  body: TBody;
  clientCreatedAt?: string; // optional display metadata only
}
```

Requirements:

- unknown schema versions are not reduced;
- `recordType` determines an exact body validator;
- `recordId`, `targetId`, and body IDs must agree with the identifier grammar;
- fields not allowed by that record type are rejected rather than copied into
  canonical state;
- JSON object keys, array sizes, string lengths, and payload sizes receive
  explicit implementation safety limits;
- payloads do not carry authoritative Core timestamps or signatures.

## 7. Trusted QDN resource metadata envelope

Discovery produces an envelope separate from the untrusted payload:

```ts
interface QdnRecordEnvelope<T> {
  resource: {
    service: string;
    publisherName: string;
    identifier: string;
    created: number | null;
    updated: number | null;
    latestSignature: string | null;
    status?: unknown;
  };
  payload: T;
  provenance: "v2" | "legacy-v1" | "derived-index";
}
```

At the currently verified Core commit, arbitrary resource results expose
`name`, `service`, `identifier`, `latestSignature`, `status`, `created`, and
`updated`. Discussion Boards must retain the required subset through parsing
and reduction.

The exact Home search response pass-through and Core metadata semantics must be
re-verified before Phase 1. If required trusted fields are unavailable through
the active bridge, Phase 1 is blocked until an authoritative alternative is
verified. Payload values must not be substituted.

## 8. Independent operations

### 8.1 Entity edit

An edit targets one Topic, Thread, or Post and contains only an allowlisted
patch:

```ts
interface EntityEditBody {
  targetType: "topic" | "thread" | "post";
  targetId: string;
  expectedOwnerPublisher: string;
  patch: Record<string, unknown>;
  editedAt: string; // display only
}
```

It is valid only when the resource publisher is the canonical entity publisher
and the patch contains only owner-controlled fields.

### 8.2 Reaction state

A reaction is independent actor state for a target Post:

```ts
interface ReactionStateBody {
  targetPostId: string;
  reaction: "like" | null;
  actorAddress: string;
}
```

The intended model is one current resource per `(target, actor, reaction
family)`. Re-publishing it changes only that actor's state; `null` removes the
reaction. Totals are derived from valid actor states. Exact actor-key hashing,
resource replacement semantics, and legacy-count coexistence are finalized in
Phase 2 after re-verification.

### 8.3 Moderation operation

Moderation operations include an explicit action:

- hide/show;
- lock/unlock;
- pin/unpin;
- mark solved/unsolved;
- moderator tombstone/restore where policy permits.

They contain target, action, optional reason, actor address, and optional
display time. They cannot contain owner content. Validity depends on trusted
role state at the operation's effective platform ordering point.

### 8.4 Owner tombstone

An owner tombstone is an independent operation published by the canonical
entity publisher. It does not copy entity content. Whether restore is allowed
must be explicit per entity type. A moderator removal is a moderation
operation, not an owner tombstone.

### 8.5 Native poll reference

A Post may refer to a Core-native poll using stable `pollId` and optional
transaction signature/display cache metadata. Poll definition, status, options,
votes, and results are read from Core and are not reconstructed from a Post
snapshot.

### 8.6 Tip transaction reference

A tip-reference operation contains:

- target Post ID;
- transaction signature/reference;
- claimed sender, recipient, amount, and asset for display/validation;
- publisher/actor identity.

The reducer counts or totals only references whose underlying transaction is
independently verified against the expected sender, target Post owner's
recipient address, QORT asset, amount, successful state, and signature.
Duplicate signatures count once. The record itself cannot prove payment.

### 8.7 Role authorization operation

Role grants and revocations are separate authorization records or an explicitly
canonical registry workflow. They must form a trusted authorization history:
each mutation is validated against the prior trusted role state. The final
choice between an operation log and primary-owner approval/republish remains
for the role phase; delegated publishers cannot become trusted merely by
claiming an administrative role.

## 9. Field-level mutation permissions

| State | Entity owner edit | Moderation op | Reaction op | Poll/Core | Tip reference | Derived only |
| --- | --- | --- | --- | --- | --- | --- |
| Topic title/description | yes | no | no | no | no | no |
| Topic access configuration | yes, within policy | no | no | no | no | no |
| Topic visibility/lock | no | yes | no | no | no | no |
| Thread title/description | yes | no | no | no | no | no |
| Thread access configuration | yes, within parent policy | no | no | no | no | no |
| Thread pin/lock/hidden/solved | no | yes | no | no | no | no |
| Thread activity summaries | no | no | no | no | no | yes |
| Post content/attachments | yes | no | no | no | no | no |
| Post pin/hidden/removal | no | yes | no | no | no | no |
| Owner deletion | tombstone op | no | no | no | no | no |
| Reaction state/count | no | no | yes | no | no | count derived |
| Poll definition/votes/results | no | no | no | Core authority | no | display cache only |
| Tip count/total | no | no | no | no | references only | verified aggregate |
| Role membership | no | authorized role op | no | no | no | reduced role state |

Unknown or cross-domain fields make an operation invalid. Reducers do not
silently ignore forbidden patch fields.

## 10. Ownership and identity validation

### 10.1 Publisher authority

QDN publisher name comes from the resource envelope. For V2:

- canonical creation fixes the authoritative publisher name;
- only that publisher's valid edits and owner tombstones are accepted;
- a different publisher cannot transfer or claim entity ownership;
- ownership transfer is unsupported until a separate, reviewed protocol is
  defined.

### 10.2 Name and wallet binding

At publication time, QDN itself associates publication with a registered name.
Application operations that require wallet identity additionally resolve or
verify the publisher name's wallet address through the current trusted
Core/Home name APIs.

Rules:

- an embedded wallet address must equal the verified address;
- the displayed author is derived from validated identity, not payload text;
- wallet comparison uses canonical address representation;
- name comparison uses the platform's verified normalization rules;
- failure to resolve a required binding rejects or defers the record; it does
  not fall back to the embedded address;
- cached name resolution must have bounded lifetime and expose stale/unknown
  state.

Name transfer creates a historical-identity problem: current name ownership may
not prove the wallet that owned the name when an older resource was published.
Before Phase 1, Core must be inspected for authoritative historical name/QDN
publisher binding suitable for creation-time validation. If unavailable, V2
must rely on a clearly documented stable publisher-name authority for
owner-controlled QDN operations and use wallet binding only where current,
verifiable address authority is required. It must not invent historical wallet
ownership.

## 11. Identifier strategy

The current application enforces a conservative 64-character QDN identifier
limit. V2 identifiers must remain at or below the verified platform limit.
The exact limit and allowed character set must be re-verified before Phase 1.

Logical families:

```text
qdb2-e-{type}-{partition}-{entityId}
qdb2-o-{operationType}-{partition}-{recordId}
qdb2-s-{indexType}-{partition}
```

Requirements:

- lowercase ASCII from the currently verified safe identifier alphabet;
- explicit entity/operation family prefix;
- deterministic partition derived from target ID;
- collision-resistant entity and record IDs from cryptographic randomness;
- no client timestamp as uniqueness proof;
- identifier components and payload IDs must match;
- actor-state identifiers use a cryptographic digest of canonical target and
  actor identity, not raw wallet/name text;
- indexes have their own namespace and cannot collide with authority records.

The final compact grammar, hash function, digest length, and collision handling
must be specified and tested in Phase 1 before publication.

## 12. Deterministic creation, ordering, and conflicts

### 12.1 Validation precedes ordering

Malformed, identifier-inconsistent, or identity-invalid records are removed
before canonical selection. A large timestamp never repairs invalid authority.

### 12.2 Trusted order key

Subject to Phase 1 verification of field semantics, the intended order key is:

```text
(trusted effective QDN time, latestSignature, publisherName, identifier)
```

For a resource's current state, effective QDN time is `updated` when present,
otherwise `created`. Numeric ascending order is applied first; normalized
lexical ascending order provides deterministic ties. Client dates never enter
authority ordering.

If Core metadata cannot provide the required deterministic distinction through
Home, the ordering design must be revised and reviewed before implementation.

### 12.3 Duplicate records

- Byte-equivalent records with the same resource key are one input.
- Repeated search results with the same `(service, publisher, identifier,
  latestSignature)` are deduplicated.
- Duplicate tip signatures count once globally.
- One actor-state resource contributes at most one current reaction state.
- Two operation resources with different record IDs are distinct even if their
  bodies match, unless the operation type defines a semantic uniqueness key.

### 12.4 Conflicting creations

Only one creation can establish an entity ID. Conflicting valid-looking
creations are resolved by the approved canonical-creation rule, and all losers
are quarantined. An edit can never create an entity.

For newly created V2 entities, identifier/publisher binding and collision
resistance make conflicts exceptional, but the reducer still requires a
deterministic rule.

### 12.5 Conflicting operations

- owner edits are applied in trusted order;
- an edit patch updates only allowlisted fields;
- actor-state resources reduce independently per actor;
- moderation actions apply in trusted order only while authorized;
- owner tombstone and moderation visibility are separate state dimensions;
- exact action precedence, including restore policy, is defined per operation
  type and tested;
- unavailable records do not imply reversal.

## 13. Reducer pipeline

The canonical reducer is a pure pipeline:

1. **Discover** paged resource envelopes and record completeness metadata.
2. **Deduplicate resources** by trusted resource key and signature.
3. **Fetch** payloads while preserving resource metadata.
4. **Parse** strict V2 or explicit V1 schemas.
5. **Validate identifiers** against resource family and payload IDs.
6. **Resolve identity** where the record type requires wallet binding.
7. **Normalize V1** into provenance-marked compatibility candidates.
8. **Select canonical creations** using the approved rule.
9. **Build authorization state**, including role history needed by operations.
10. **Validate operations** against canonical owner and role state.
11. **Sort accepted operations** by trusted deterministic order.
12. **Reduce owner edits**, tombstones, moderation, reactions, poll references,
    and verified tip references into separate state domains.
13. **Validate index hints** against canonical entity records.
14. **Produce view state** with provenance, completeness, unavailable, cached,
    and quarantine diagnostics.

No UI cache, optimistic update, or index snapshot participates as authority.
Optimistic state must be reconciled through the same validator/reducer after
publication.

## 14. Quarantine and rejection taxonomy

Every excluded record receives a machine-readable reason:

| Code | Meaning |
| --- | --- |
| `unsupported-schema` | Unknown schema/version |
| `malformed-payload` | Shape, type, or safety-limit failure |
| `identifier-mismatch` | Resource identifier and payload identity disagree |
| `invalid-entity-reference` | Target or parent does not exist or has wrong type |
| `publisher-mismatch` | Embedded publisher claim differs from resource publisher |
| `identity-unresolved` | Required authoritative identity cannot be resolved |
| `wallet-mismatch` | Claimed wallet differs from verified publisher wallet |
| `unauthorized-creation` | Publisher lacks creation permission |
| `conflicting-creation` | Valid-looking non-canonical creation for an existing ID |
| `unauthorized-owner-operation` | Publisher is not canonical owner |
| `unauthorized-moderation` | Actor lacks role at effective operation order |
| `forbidden-fields` | Operation attempts cross-domain mutation |
| `duplicate-record` | Trusted or semantic duplicate |
| `invalid-order-metadata` | Required trusted ordering metadata is absent/invalid |
| `suspicious-client-time` | Client time is implausible; retained only if otherwise safe |
| `unverified-transaction` | Tip/poll transaction reference cannot be verified |
| `index-entry-unverified` | Index hint has no matching valid authority record |
| `resource-unavailable` | Discovered resource could not be fetched |

`resource-unavailable` is a data-availability state, not proof of malicious
content. Quarantine diagnostics must avoid rendering unsafe payload content and
must not leak restricted UI data beyond what is already public on QDN.

## 15. Legacy V1 reader and normalization

The V1 reader:

- recognizes only known V1 topic, subtopic, post, role, and index shapes;
- preserves QDN resource publisher and trusted metadata;
- sanitizes rich content and attachment references using explicit limits;
- maps `SubTopic` to canonical Thread;
- separates embedded operational fields from normalized entity content;
- labels all output `legacy-v1`;
- retains client timestamps only for display;
- never upgrades an embedded author claim into trusted identity by itself.

Canonical normalization produces:

```ts
interface CanonicalEntityView {
  entityType: "topic" | "thread" | "post";
  entityId: string;
  ownerPublisherName: string | null;
  ownerWalletAddress: string | null;
  provenance: "legacy-v1" | "v2";
  authorityStatus: "canonical" | "compatibility" | "blocked" | "quarantined";
  content: unknown;
  legacyState?: {
    reactions?: unknown;
    poll?: unknown;
    tips?: unknown;
    moderation?: unknown;
  };
}
```

Legacy likes, poll snapshots, tip counts, and moderation fields may be displayed
as historical compatibility state until their migration phases. They do not
authorize V2 mutations and must not be merged into V2 aggregates without a
phase-specific deduplication rule.

## 16. V1/V2 coexistence and precedence

1. A valid V2 canonical entity is authoritative over all V1 snapshots for the
   same adopted entity.
2. V1 records remain readable when no V2 adoption exists.
3. A V1 record published after V2 adoption cannot override V2.
4. V2 operations cannot target a legacy entity until that entity has a valid
   adoption mapping or the operation phase defines a reviewed compatibility
   target.
5. Index entries never establish coexistence precedence.
6. Local cached data may fill an unavailable display temporarily but is marked
   cached and cannot accept authority-changing operations.

## 17. Legacy canonical-publisher decision — BLOCKING Phase 1

### 17.1 Exact problem

Live V1 data contains legitimate copies of the same embedded logical IDs under
different QDN publishers because reactions, votes, moderation, deletion, and
other operations republished complete snapshots. The current payload does not
reliably distinguish the original creation from later operational copies.

Selecting:

- the highest client `updatedAt` repeats the vulnerability;
- the earliest QDN resource may select incomplete or unintended data;
- the embedded author trusts an unverified claim;
- the current index trusts a derived snapshot;
- one hard-coded publisher can erase legitimate user ownership.

Current repository evidence is insufficient to choose a universal canonical
V1 publisher safely.

### 17.2 Evidence inspected on 2026-07-20

Read-only searches were run against the public QDN API used by the currently
checked-out Home reference. The searches used the V1 `qdbm-topic-`,
`qdbm-sub-`, and `qdbm-post-` identifier families with a result limit of 1,000.
This is an evidence snapshot, not proof that discovery was complete.

Within that snapshot:

- 18 Topic identifiers had resources under more than one publisher;
- 11 Thread/SubTopic identifiers had resources under more than one publisher;
- 20 current partitioned Post identifiers had resources under more than one
  publisher;
- 12 logical Post IDs appeared under both the original
  `qdbm-post-{postId}` identifier and the newer
  `qdbm-post-{threadPartition}-{postId}` identifier.

Representative live patterns included:

- Topic `topic_01knmbmrqyywsq_8bwvdf0kzt8k7atc` under
  `Discussion_Boards`, `developer iffi`, and `iffi vaba mees`;
- Thread `subtopic_01knr5h3881bzw_0y550zyta08et086` under
  `iffi vaba mees`, `Discussion_Boards`, and `developer iffi`;
- Thread `subtopic_01knxaqqdcyuaj_z04f57tsdskwwxhj` under
  `Qortal-Video-Bridge`, `Discussion_Boards`, and `iffi vaba mees`;
- Post `post_01kq7fvw3gywsq_r88c7gcd65zfn5vn` under four publishers, with
  later available copies retaining embedded author `Discussion_Boards` while
  carrying a changed poll-vote set;
- Post `post_01krn8k49fyuaj_v8rpxsgwjnn0x8ex` under six publishers, with
  an available first-publisher copy retaining embedded author
  `Qortal-Video-Bridge` and later copies changing reaction/poll state;
- QDN deletion tombstones under publishers other than the embedded creator.

Some discovered resources returned unavailable or non-forum QDN deletion
payloads while their Core resource envelopes and other publishers' copies
remained visible. This demonstrates why current payload availability cannot be
a prerequisite for recognizing that a publisher/resource key existed.

### 17.3 Historical publication paths

The V1 source confirms the following full-snapshot publications:

| Entity | Original creation | Legitimate later cross-publisher copies |
| --- | --- | --- |
| Topic | An authorized admin creates the ID and publishes the Topic under the current QDN name | Another admin can change settings; a Super Admin/SysOp reorder republishes every Topic under the reordering user's name |
| Thread | An allowed user creates the ID and publishes the SubTopic under the current QDN name | Moderators/admins can publish lock/settings/visibility/pin/solved snapshots; pinned-thread reorder republishes affected Threads under the staff user's name |
| Post | The author creates the ID and publishes the Post under the current QDN name | Likes, poll votes, poll closure, staff pinning, staff deletion, and tip-counter synchronization publish complete Post state under the actor's name; author edits republish under the author's current name |

Indexes are also republished under every mutating user's name, but index
publishers are never entity-owner candidates. Role registry duplicates are a
separate authorization-domain problem and cannot establish Topic, Thread, or
Post ownership.

The current source does not show QDN publication of a Thread entity merely to
update `lastPostAt`; post creation changes that field in the topic-directory
index. That index change is derived evidence only.

### 17.4 Verified Core metadata semantics

At Core commit `c000a0cd4a1ebaaab5aa753f3cd199f3302ff5bf`:

- a resource key is `(publisher name, service, identifier)`;
- resource `created` is the minimum transaction timestamp Core has reduced for
  that resource key;
- resource `updated` is the latest resource transaction timestamp when it
  differs from creation;
- `latestSignature` identifies the latest resource transaction, not the first;
- every named arbitrary-data transaction is valid only when its signer owns
  the registered name at that transaction's validation point;
- unconfirmed transaction timestamps are rejected when expired/too old or
  beyond the configured future margin.

Consequently, the QDN publisher name is chain-authenticated at each
publication. The resource search envelope does not, however, expose the first
transaction signature or its creator public key. A current name lookup proves
current ownership, not historical wallet ownership.

Historical wallet ownership can be proven if the exact first arbitrary
transaction is retrieved and its creator address/signature is verified. The
currently inspected public resource-search surface does not provide a
resource-key-filtered history or first signature. Phase 1 must not infer the
historical wallet from the current name owner.

Core `created` is stronger evidence than payload `createdAt` or `updatedAt`,
but it is still based on a transaction timestamp supplied by the signer within
Core's validity window. It is not equivalent to an immutable block-order
sequence number.

### 17.5 Candidate rules and risks

| Candidate | Benefit | Risk |
| --- | --- | --- |
| Earliest Core resource `created` for a logical entity across all identifier variants | Matches the observed create-before-mutate flow; resistant to payload future timestamps; preserves deleted/unavailable first resource keys | Incomplete discovery can omit the original; a transaction timestamp is signer-supplied within bounds; imports or failed multi-resource creation can make the first visible resource non-original |
| Latest Core resource/payload | Preserves the most recent V1 UI result | Known live later publishers are voters, reactors, moderators, tippers, or reordering admins; grants ownership to an operation actor |
| Publisher whose current wallet matches embedded creator | Easy with current name API | Current ownership is not historical ownership; embedded creator is forgeable; name transfer can produce a false match or mismatch |
| Publisher named by the majority of embedded creator claims | Later legitimate copies often preserve creator fields | An attacker can mass-publish copies; unavailable records bias the sample; the claim remains untrusted |
| Publisher/identifier found in earliest trusted index | May reflect live historical structure | Index is derived, replaceable, and sometimes newer than entities |
| Known deployment/bootstrap authority for Topics only | May fit administrator-created top-level structure | Cannot safely generalize to user Threads/Posts |
| Reviewed migration manifest recording evidence and canonical publisher | Freezes an auditable result for the bounded legacy corpus and supports explicit exceptions | Requires complete fixture capture, governance, reproducibility, and a rule for newly discovered legacy records |
| Quarantine every ambiguous entity pending review | Safest against takeover | Hides legitimate existing content and damages compatibility |
| Earliest-candidate algorithm plus reviewed manifest and quarantine | Uses the strongest observed general signal while refusing unsupported ownership | More complex; cannot unblock until full corpus fixtures and exceptions are reviewed |

No inspected live example proved that a later publisher was the original
creator. Multiple examples proved that the latest publisher was not the
creator. No verified counterexample to the earliest-resource candidate was
found in the representative payloads that were available, but unavailable
resources and incomplete history prevent treating this as proof of a universal
rule.

### 17.6 Proposed constrained canonicalization algorithm

This is the evidence-backed candidate to validate against the complete fixture
set. It is not yet approved for production:

1. Establish a fixed V1 migration cutoff using a reviewed Core height and
   timestamp. V1 records first appearing after the cutoff are not automatically
   adoptable.
2. Discover every V1 entity resource through complete pagination, including all
   known legacy and partitioned identifier forms. Exclude indexes and role
   resources from owner candidacy.
3. Group records by validated logical entity type and ID. For Posts, group both
   `qdbm-post-{postId}` and
   `qdbm-post-{threadPartition}-{postId}` forms.
4. Deduplicate exact resource envelopes and retain unavailable/tombstoned
   resource keys.
5. Select the **earliest-publisher candidate** from the minimum Core
   `created` value across publisher/resource keys. Ties do not resolve by
   payload time; they require first-transaction/block evidence or quarantine.
6. Build an immutable fingerprint from every available valid copy:
   - Topic: entity ID and creation display time;
   - Thread: entity ID, parent Topic ID, creation display time, and embedded
     creator claim;
   - Post: entity ID, parent Thread ID, parent Post ID, creation display time,
     and embedded creator claim.
7. Require all available pre-cutoff copies used for adoption to agree on the
   immutable fingerprint. Mutable content, moderation, reactions, votes, tips,
   indexes, and client update times do not participate.
8. Treat a normalized embedded creator equal to the earliest-publisher
   candidate as corroboration only. A mismatch is an ambiguity requiring
   transaction evidence or quarantine; a match cannot override earlier Core
   evidence.
9. Require the canonical parent entity to be known and the candidate resource
   time to be plausible relative to the entity ID/creation display time.
   Plausibility is a rejection signal, not ownership proof.
10. Where the first transaction can be retrieved, verify its signature,
    creator address, name, service, identifier, confirmation, and block
    placement. Record the historical wallet only from that evidence.
11. Materialize the reviewed result as a versioned migration fixture/manifest
    containing the logical ID, entity type, canonical publisher name, all
    considered resource keys, evidence fields, decision status, and rationale.
12. At runtime, automatically adopt only manifest-approved mappings. A newly
    discovered or changed ambiguous V1 record remains compatibility-only and
    cannot publish V2 owner operations until reviewed.

The general signal is the same for Topic, Thread, and Post, but validation is
entity-type-specific because their legitimate duplicate causes and immutable
fingerprints differ.

### 17.7 Security and compatibility properties

The constrained algorithm:

- does not grant ownership to the latest voter/reactor/moderator/admin;
- does not use client `updatedAt` as authority;
- does not make an index authoritative;
- preserves first resource keys whose latest content is deleted or
  unavailable;
- uses embedded author only as corroboration;
- prevents incomplete or novel legacy data from silently gaining V2 authority;
- supports explicit, auditable exceptions.

It can still fail if the fixture omits an earlier resource, if the earliest
transaction timestamp was adversarially manipulated within Core bounds, if an
entity was imported without its original resource, or if the original
multi-resource creation failed before publishing the entity. Those cases
require transaction/block evidence or quarantine.

### 17.8 Required live-data fixtures and evidence

Before selecting the rule, collect a read-only fixture set containing:

- every live publisher/resource envelope for all pre-cutoff Topic, Thread, and
  Post IDs, not only representative duplicates;
- every known legacy and partitioned Post identifier for each logical Post;
- paginated search diagnostics demonstrating whether the capture completed;
- Core `created`, `updated`, and `latestSignature` metadata;
- resource identifier, embedded ID, parent IDs, embedded author, and payload
  timestamps;
- current payload availability and QDN deletion/tombstone status;
- first arbitrary transaction and block evidence where accessible;
- current and historical name-to-wallet ownership only when independently
  verifiable;
- known legitimate creator evidence supplied by maintainers;
- publication sequence around known reactions, moderation, votes, and edits;
- unavailable-resource cases where indexes remain readable;
- at least one unambiguous entity per type and every known ambiguous pattern;
- explicit tests for import, failed entity-plus-index publication, timestamp
  ties, and an omitted-original-resource simulation.

The fixture must be sanitized only where doing so does not remove identity or
ordering evidence. Expected canonical outcomes and rationale must be reviewed
and checked into a test-fixture area before Phase 1 reducer implementation.

### 17.9 Safe fallback

If discovery is partial, immutable fingerprints conflict, the earliest
candidate ties, parent authority is unresolved, or required evidence is
unavailable:

- retain parseable content as `legacy-v1` compatibility display where safe;
- mark publisher authority `blocked`;
- do not permit V2 adoption, owner edit, owner tombstone, or ownership transfer;
- do not let a later publisher or index fill the authority gap;
- expose a stable quarantine/diagnostic reason;
- allow a later reviewed manifest revision to resolve the record.

### 17.10 Blocking decision

**BLOCKING PHASE 1:** the investigation narrows the likely solution to the
constrained earliest-candidate algorithm plus a reviewed migration manifest,
but does not yet prove the complete legacy corpus. Phase 1 may not ship
canonical legacy ownership selection or enable V2 adoption until:

1. a cutoff height/timestamp is approved;
2. the complete paginated pre-cutoff fixture is captured and reviewed;
3. first-transaction evidence is obtained for every ambiguity where the
   earliest candidate is not sufficiently corroborated;
4. the migration manifest format, signing/publication authority, and update
   governance are approved;
5. maintainers confirm or correct the representative canonical mappings;
6. tests demonstrate that legitimate duplicates remain readable, operational
   publishers do not gain ownership, and incomplete discovery quarantines
   safely.

## 18. Legacy-to-V2 adoption

Adoption is non-destructive:

1. Read and normalize the canonical V1 compatibility entity.
2. Require the user to authenticate as the approved legacy canonical owner.
3. Publish a V2 creation/adoption record containing the stable legacy ID,
   canonical parent mapping, owner identity, normalized owner-controlled
   content, and references to source V1 resource keys.
4. Validate the adoption through the V2 reducer.
5. Publish subsequent changes as V2 operations.
6. Never overwrite or delete the V1 resource merely to migrate it.

An adoption record cannot resolve ambiguous ownership by assertion. It is valid
only under the approved legacy canonical-publisher rule. Staff cannot adopt a
user's entity merely because they can moderate it.

Bulk automatic adoption is out of scope until the live fixture rule is proven.

## 19. Derived index model

V2 indexes contain locators and optional display/cache hints, not complete
authority:

```ts
interface EntityIndexEntry {
  entityType: "topic" | "thread" | "post";
  entityId: string;
  publisherName: string;
  identifier: string;
  parentId: string | null;
  hint?: {
    title?: string;
    excerpt?: string;
    activityAt?: string;
  };
}
```

Rules:

- every entry is validated by fetching and reducing its authority record;
- hint disagreement never changes the entity;
- index publishers do not acquire entity authority;
- indexes can be deleted and rebuilt from authority records;
- index revision timestamps rank index snapshots only, never entity state;
- indexes omit restricted-content excerpts unless the privacy design explicitly
  permits public disclosure;
- partial or poisoned indexes fall back to authoritative discovery within
  safety budgets;
- index partitions are deterministic and paginated in the scaling phase.

Legacy indexes may help find unavailable resources but their embedded content
is marked cached/index-derived and cannot become authoritative.

## 20. Partial and unavailable data

Every load result carries:

```ts
type Completeness = "complete" | "partial" | "unknown";

interface LoadDiagnostics {
  completeness: Completeness;
  pagesRead: number;
  recordsDiscovered: number;
  recordsFetched: number;
  unavailable: number;
  quarantined: number;
  safetyBudgetReached: boolean;
  lastKnownGoodUsed: boolean;
}
```

Rules:

- a fixed query limit never implies completion;
- reaching a page/record/time budget produces `partial`;
- a discovered but unavailable authority resource remains unavailable;
- a last-known-good entity may be shown with a stale/cached badge;
- an index-only entry is not shown as freshly verified content;
- absence in a partial result is not deletion;
- destructive or authority-sensitive actions are disabled when required
  authority state is unavailable or ambiguous;
- cache reconciliation uses trusted resource metadata, not post client dates.

Pagination and production safety budgets are implemented in Phase 6, but Phase
1 data types and reducers must not encode “first 1,000 equals all.”

## 21. Native poll reference architecture

### 21.1 Invariant

Core is authoritative for a native poll's identity, definition, schedule,
options, votes, closure, and results. A Post stores only a validated reference
and optional non-authoritative display cache. Voting never republishes a Post.

### 21.2 Currently verified capability

At the recorded Core commit:

- polls have stable numeric `pollId`;
- Core supports create, vote, and update transactions;
- poll reads support ID/name lookup, vote details/counts, and filtered/paged
  search;
- poll data includes owner, publication time, optional start/end time, and
  options;
- result models expose raw counts and trust/minting-derived weighting;
- timed closed-poll results can be frozen;
- vote removal/change and multiple selections exist at Core transaction level,
  subject to current validation rules.

At the recorded Home commit:

- `CREATE_POLL`, `VOTE_ON_POLL`, and `UPDATE_POLL` are bridge actions;
- creation accepts start and end scheduling fields;
- voting accepts `optionIndexes` as well as a single `optionIndex`;
- write responses return `transactionSignature`;
- Home handles approval, unsigned construction, signing, processing, and
  capability-gated public-node poll writes.

This is newer than issue #1's historical observation that Home creation omitted
start time and voting exposed only one option. The historical observation
describes the bridge version reviewed then, not the current reference.

### 21.3 Phase 3 re-verification

Before integration, re-check:

- bridge action availability via current capability discovery;
- exact create/vote/update request and response shapes;
- poll ID discovery from a create transaction/signature;
- fee or zero-fee/MemoryPoW behavior;
- start/end/update restrictions;
- multiple-choice and vote-removal semantics;
- raw versus weighted result fields and closure behavior;
- public-node and local-node parity.

The UI must explicitly label whether it displays raw counts, weighted results,
or both.

## 22. QORT tip-reference boundary

### 22.1 Invariant

Payment is authoritative only when verified from Core transaction state. The
Home response and a QDN tip-reference payload are evidence locators, not
independent proof. Mutable Post tip counters are never authoritative.

### 22.2 Currently verified capability

At the recorded Home commit, native `SEND_COIN`/`PAYMENT` handling returns a
`transactionSignature` with recipient and amount after an approved processed
transaction. The current app uses `SEND_COIN` but discards that signature and
increments `Post.tips`.

### 22.3 Phase 5 re-verification

Before implementation, inspect the current:

- preferred native-QORT bridge action;
- response and cancellation/error shape;
- Core transaction lookup endpoint and confirmation semantics;
- transaction type/asset representation;
- sender, recipient, amount, fee, timestamp, and signature fields;
- reorg/unconfirmed behavior and duplicate-reference handling.

The V2 tip reducer accepts only confirmed transaction references meeting the
verified target-owner recipient and amount rules.

## 23. Moderation and role boundaries

Moderation is an operation domain:

- it cannot alter owner content;
- moderator identity is bound to the resource publisher and wallet;
- authorization is checked against trusted role state at the operation's
  effective order;
- losing a role prevents later moderation but does not retroactively invalidate
  actions that were authorized under the approved temporal model;
- action/reversal precedence is deterministic.

Role state is an authorization domain:

- the canonical trust root is explicit;
- delegated changes require prior-state authorization;
- loader and publisher trust rules must agree;
- current V1 delegated publications remain compatibility evidence but are not
  silently trusted;
- exact temporal authorization and registry/operation choice are Phase 4
  design decisions that must conform to these invariants.

Phase 1 may define interfaces and enforce owner boundaries but must not mix in
the full moderation/role migration.

## 24. Restricted access and privacy

Unencrypted QDN `DOCUMENT`, media, and index resources are public. Wallet
allowlists and role checks provide **restricted UI access**, not
confidentiality.

Required terminology:

- “restricted discussion” or “restricted UI access” for public QDN data hidden
  by the official UI;
- “encrypted/private” only when an approved encryption, key distribution,
  revocation, and index-leakage design provides confidentiality.

Indexes must not imply privacy and should minimize unnecessary restricted
content hints. A modified client or direct Core request can still retrieve
public QDN content.

## 25. Phased migration boundaries

The GitHub dependency graph remains authoritative. Current planned order:

1. **Architecture V2 documentation (#2):** approve this design and resolve
   blocking prerequisites.
2. **Phase 1 (#3):** entity ownership, metadata envelopes, strict validation,
   deterministic reducer, quarantine, V1 reader, and proven legacy rule.
3. **Phase 2 (#4):** independent authenticated reactions.
4. **Phase 3 (#5):** native Core polls and Home bridge writes.
5. **Phase 4 (#6):** moderation operations and role authorization redesign.
6. **Phase 5:** verified transaction-based tips.
7. **Phase 6:** paginated QDN discovery and rebuildable indexes.
8. Correct restricted-access/privacy terminology.
9. Correct delegated role persistence where not completed in Phase 4.
10. Harden bridge detection and large-file source-token publication.
11. Align Home display settings and localization.
12. Restore dependency/lint/format baseline.
13. Add QAVS manifest, license, version, and release metadata.

Each phase:

- re-verifies Core/Home contracts;
- changes the smallest coherent state domain;
- preserves unrelated working behavior;
- adds architecture-sensitive tests;
- passes project checks and production build;
- receives review before the dependent phase begins.

No phase may make indexes authoritative as a shortcut.

## 26. Required fixtures

Fixture families:

1. valid V2 Topic, Thread, and Post creation by correct publisher;
2. authorized owner edits for every allowlisted field;
3. unrelated publisher reusing an entity ID;
4. forged embedded publisher, author, actor, and wallet;
5. duplicate creation IDs with deterministic trusted metadata;
6. far-future and malformed client timestamps;
7. identical trusted timestamps with signature/identifier tie-breaks;
8. forbidden cross-domain edit fields;
9. owner and moderation tombstones;
10. moderation before, during, and after role validity;
11. multiple independent reactions and actor removal/change;
12. native poll references with missing/mismatched Core polls;
13. valid, duplicate, unconfirmed, wrong-recipient, wrong-amount, and fabricated
    tip signatures;
14. legacy V1 entity per type;
15. every known live duplicate-publisher pattern;
16. mixed V1/V2 state before and after adoption;
17. V1 snapshot published after V2 adoption;
18. valid, stale, poisoned, incomplete, and unavailable-resource indexes;
19. paged discovery, safety-budget exhaustion, and prefix flooding;
20. last-known-good cache with unavailable authoritative resource;
21. current-name transfer/historical-wallet ambiguity;
22. malformed/oversized payload and attachment references.

Fixtures that represent live QDN records must preserve the resource metadata
needed to reproduce ordering and identity decisions.

## 27. Acceptance tests

### 27.1 Issue #2 architecture acceptance

- authoritative Topic, Thread, and Post schemas are explicit;
- ownership and update authority are explicit;
- independent operation types and boundaries are explicit;
- publisher/actor validation is explicit;
- ordering does not depend solely on `updatedAt`;
- reducer stages and quarantine behavior are explicit;
- V1 compatibility, coexistence, and adoption are explicit;
- indexes are derived and non-authoritative;
- the unresolved legacy publisher rule is identified as blocking rather than
  invented.

### 27.2 Phase 1 implementation acceptance

After the blocking legacy decision is resolved:

- correct publisher creation succeeds;
- forged or unrelated publisher creation/update cannot win;
- embedded identity is never trusted alone;
- future client timestamps do not change authority;
- duplicate/conflicting creation resolves deterministically;
- valid owner edits change only allowed fields;
- invalid records receive stable quarantine reasons;
- legacy fixtures remain readable;
- reload produces identical canonical state;
- partial/unavailable data is visible and safe;
- production build and existing unrelated features continue to work.

### 27.3 Later-phase acceptance

Each operation phase tests:

- correct publisher/wallet binding;
- concurrency between independent actors;
- idempotency and duplicates;
- invalid and unavailable platform references;
- V1 compatibility and no double counting;
- deterministic reload;
- indexes remaining non-authoritative.

## 28. Open decisions

### Blocking Phase 1

1. Approval of the constrained earliest-candidate algorithm, V1 cutoff, and
   migration-manifest governance after complete fixture review.
2. Availability of first-transaction/block evidence and historical wallet
   binding for ambiguous legacy resources. Current name ownership is
   insufficient.
3. Confirmation that required trusted QDN resource metadata is available
   through the current Home bridge.
4. Final compact identifier grammar/hash after current Core constraints are
   re-verified.

### Deferred to their workflow phases

1. Reaction actor-state identifier and legacy like-count transition.
2. Native poll UI result model and create-signature-to-poll-ID resolution.
3. Moderation temporal role semantics and role operation/registry choice.
4. Core confirmation threshold and exact validation fields for tips.
5. Pagination safety budgets and index partition sizes.
6. Encryption design, if true confidentiality is ever required.
7. Large-file source-token behavior on every supported Home platform.

Deferred decisions may not violate the invariants in section 3.
