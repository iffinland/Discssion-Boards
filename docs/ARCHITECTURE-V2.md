# Discussion Boards Architecture V2

Status: **Implemented through Phase 6 and delegated-role persistence issue #7**

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

| Repository        | Path                               | Verified commit                                                    |
| ----------------- | ---------------------------------- | ------------------------------------------------------------------ |
| Discussion Boards | this repository                    | `3f17fb329f8f2419454c18b6c1f3c383027b858f` (Phase 6 worktree base) |
| Qortium Core      | `../../github-clones/qortium-core` | `c000a0cd4a1ebaaab5aa753f3cd199f3302ff5bf`                         |
| Qortium Home      | `../../github-clones/qortium-home` | `a41e5f9678d7f20d7fb77a223c45fddc0096632e`                         |

The Discussion Boards production source reviewed by architecture issue #1
remains commit `f20f93c833ef74dc83a22a59be2d1c6682e96bde`.
The later Discussion Boards commit above is the clean Phase 5 implementation
base and includes the completed earlier Architecture V2 phases.

GitHub specification inspected:

- issue #1, architecture review;
- issue #2, Architecture V2 prerequisite and acceptance criteria;
- issue #3, Phase 1 ownership/state authorization;
- issue #4, Phase 2 independent reactions;
- issue #5, Phase 3 native polls;
- issue #6, Phase 4 moderation and role authorization;
- issue #7, delegated role-registry persistence;
- issue #8, verified transaction-reference tips;
- issue #10, scalable QDN pagination and rebuildable indexes;
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
type EntityType = 'topic' | 'thread' | 'post';

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
  schema: 'qdb-v2';
  schemaVersion: 2;
  kind: 'entity-create' | 'operation' | 'index';
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
  provenance: 'v2' | 'legacy-v1' | 'derived-index';
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
  targetType: 'topic' | 'thread' | 'post';
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
  targetId: string;
  reaction: 'like';
  state: 'active' | 'inactive';
  publisherName: string;
  walletAddress: string;
}
```

The model is one mutable current resource per `(target, actor, reaction
family)`. Re-publishing it changes only that actor's state; `inactive` removes
the reaction from the derived count. The identifier uses the application V2
reaction prefix plus 80-bit SHA-256 prefixes of the target and normalized
publisher/wallet actor key, remaining below Core's verified 64-character
limit. The loader recomputes this identifier and requires both the envelope
record ID and trusted resource identifier to match it. Totals are derived from valid actor states ordered by trusted Core
`updated`, latest signature, and identifier metadata. Legacy counters remain
read-only display fallback only when no V2 actor state exists, preventing
double-counting. Equal trusted ordering keys with conflicting active/inactive
states quarantine that actor state rather than allowing discovery order to
choose a winner. Reaction discovery failure does not make the Post unreadable:
the compatibility view retains its legacy historical display values while the
independent reaction authority remains unavailable.

The currently verified public APIs expose current QDN name ownership but not a
reliable historical name-to-wallet binding at publication time. Reaction state
therefore requires a successful current publisher/name/wallet binding. A name
transfer or unavailable binding makes the affected actor state unverifiable
and excludes it from the authenticated count; current ownership is never used
as proof of historical legacy reactions.

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

| State                         | Entity owner edit         | Moderation op      | Reaction op | Poll/Core      | Tip reference   | Derived only       |
| ----------------------------- | ------------------------- | ------------------ | ----------- | -------------- | --------------- | ------------------ |
| Topic title/description       | yes                       | no                 | no          | no             | no              | no                 |
| Topic access configuration    | yes, within policy        | no                 | no          | no             | no              | no                 |
| Topic visibility/lock         | no                        | yes                | no          | no             | no              | no                 |
| Thread title/description      | yes                       | no                 | no          | no             | no              | no                 |
| Thread access configuration   | yes, within parent policy | no                 | no          | no             | no              | no                 |
| Thread pin/lock/hidden/solved | no                        | yes                | no          | no             | no              | no                 |
| Thread activity summaries     | no                        | no                 | no          | no             | no              | yes                |
| Post content/attachments      | yes                       | no                 | no          | no             | no              | no                 |
| Post pin/hidden/removal       | no                        | yes                | no          | no             | no              | no                 |
| Owner deletion                | tombstone op              | no                 | no          | no             | no              | no                 |
| Reaction state/count          | no                        | no                 | yes         | no             | no              | count derived      |
| Poll definition/votes/results | no                        | no                 | no          | Core authority | no              | display cache only |
| Tip count/total               | no                        | no                 | no          | no             | references only | verified aggregate |
| Role membership               | no                        | authorized role op | no          | no             | no              | reduced role state |

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

| Code                           | Meaning                                                     |
| ------------------------------ | ----------------------------------------------------------- |
| `unsupported-schema`           | Unknown schema/version                                      |
| `malformed-payload`            | Shape, type, or safety-limit failure                        |
| `identifier-mismatch`          | Resource identifier and payload identity disagree           |
| `invalid-entity-reference`     | Target or parent does not exist or has wrong type           |
| `publisher-mismatch`           | Embedded publisher claim differs from resource publisher    |
| `identity-unresolved`          | Required authoritative identity cannot be resolved          |
| `wallet-mismatch`              | Claimed wallet differs from verified publisher wallet       |
| `unauthorized-creation`        | Publisher lacks creation permission                         |
| `conflicting-creation`         | Valid-looking non-canonical creation for an existing ID     |
| `unauthorized-owner-operation` | Publisher is not canonical owner                            |
| `unauthorized-moderation`      | Actor lacks role at effective operation order               |
| `forbidden-fields`             | Operation attempts cross-domain mutation                    |
| `duplicate-record`             | Trusted or semantic duplicate                               |
| `invalid-order-metadata`       | Required trusted ordering metadata is absent/invalid        |
| `suspicious-client-time`       | Client time is implausible; retained only if otherwise safe |
| `unverified-transaction`       | Tip/poll transaction reference cannot be verified           |
| `index-entry-unverified`       | Index hint has no matching valid authority record           |
| `resource-unavailable`         | Discovered resource could not be fetched                    |

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
  entityType: 'topic' | 'thread' | 'post';
  entityId: string;
  ownerPublisherName: string | null;
  ownerWalletAddress: string | null;
  provenance: 'legacy-v1' | 'v2';
  authorityStatus: 'canonical' | 'compatibility' | 'blocked' | 'quarantined';
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
checked-out Home reference. The migration fixture capture now uses complete
identifier-prefix queries with `limit=0` (unbounded), rather than the V1
reader's fixed 1,000-result assumption. This remains a dated evidence
snapshot, not a permanent capability target; the raw review artifact is
`docs/migration/legacy-fixture-inventory.json`.

Within that snapshot:

- 39 Topic resources represented 20 logical IDs, with 18 duplicate groups;
- 62 Thread/SubTopic resources represented 49 logical IDs, with 11 duplicate
  groups;
- 212 Post resources represented 169 logical IDs, with 20 duplicate groups;
- the capture preserves both legacy and partitioned Post identifier families;
  cross-family equivalence remains a review classification, not an automatic
  authority decision.

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

| Entity | Original creation                                                                     | Legitimate later cross-publisher copies                                                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Topic  | An authorized admin creates the ID and publishes the Topic under the current QDN name | Another admin can change settings; a Super Admin/SysOp reorder republishes every Topic under the reordering user's name                                                                                    |
| Thread | An allowed user creates the ID and publishes the SubTopic under the current QDN name  | Moderators/admins can publish lock/settings/visibility/pin/solved snapshots; pinned-thread reorder republishes affected Threads under the staff user's name                                                |
| Post   | The author creates the ID and publishes the Post under the current QDN name           | Likes, poll votes, poll closure, staff pinning, staff deletion, and tip-counter synchronization publish complete Post state under the actor's name; author edits republish under the author's current name |

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
  differs from creation and is nullable on an initial publication; reducers
  use `created` as the effective trusted time when `updated` is absent;
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

| Candidate                                                                            | Benefit                                                                                                                                   | Risk                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Earliest Core resource `created` for a logical entity across all identifier variants | Matches the observed create-before-mutate flow; resistant to payload future timestamps; preserves deleted/unavailable first resource keys | Incomplete discovery can omit the original; a transaction timestamp is signer-supplied within bounds; imports or failed multi-resource creation can make the first visible resource non-original |
| Latest Core resource/payload                                                         | Preserves the most recent V1 UI result                                                                                                    | Known live later publishers are voters, reactors, moderators, tippers, or reordering admins; grants ownership to an operation actor                                                              |
| Publisher whose current wallet matches embedded creator                              | Easy with current name API                                                                                                                | Current ownership is not historical ownership; embedded creator is forgeable; name transfer can produce a false match or mismatch                                                                |
| Publisher named by the majority of embedded creator claims                           | Later legitimate copies often preserve creator fields                                                                                     | An attacker can mass-publish copies; unavailable records bias the sample; the claim remains untrusted                                                                                            |
| Publisher/identifier found in earliest trusted index                                 | May reflect live historical structure                                                                                                     | Index is derived, replaceable, and sometimes newer than entities                                                                                                                                 |
| Known deployment/bootstrap authority for Topics only                                 | May fit administrator-created top-level structure                                                                                         | Cannot safely generalize to user Threads/Posts                                                                                                                                                   |
| Reviewed migration manifest recording evidence and canonical publisher               | Freezes an auditable result for the bounded legacy corpus and supports explicit exceptions                                                | Requires complete fixture capture, governance, reproducibility, and a rule for newly discovered legacy records                                                                                   |
| Quarantine every ambiguous entity pending review                                     | Safest against takeover                                                                                                                   | Hides legitimate existing content and damages compatibility                                                                                                                                      |
| Earliest-candidate algorithm plus reviewed manifest and quarantine                   | Uses the strongest observed general signal while refusing unsupported ownership                                                           | More complex; cannot unblock until full corpus fixtures and exceptions are reviewed                                                                                                              |

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

### 17.10 Final readiness boundary

The investigation narrows the likely solution to the constrained
earliest-candidate algorithm plus a reviewed migration manifest, but cannot
prove every historical mapping. This is a **blocking prerequisite for
automatic legacy authority migration**, not for implementing the fail-closed
V2 foundation. Phase 1 may begin only under the authority-state boundary in
section 17.11. Automatic legacy adoption and inherited owner authority remain
feature-gated until:

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

The current maintainer-review package classifies all 49 duplicate groups
without granting authority: 35 are `AUTO-CANDIDATE` (unique earliest
same-family envelope, expedited review only), 5 are `REVIEW-REQUIRED`, and 9
are `QUARANTINE` (legacy/partitioned identifier conflict or four-or-more
publishers). The per-group evidence and blank human decision fields are in
`docs/migration/legacy-canonical-publisher-review.json`. This classification
does not resolve the blocker: payload immutable-field checks, tombstone and
unavailable-payload enrichment, and maintainer decisions remain required.

### 17.11 Legacy authority states and Phase 1 boundary

Every normalized V1 entity has exactly one migration authority state:

| State         | Read compatibility                                   | Inherited V2 owner authority                    | Owner/destructive mutation                                     | Automatic adoption                    |
| ------------- | ---------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------- | ------------------------------------- |
| `APPROVED`    | allowed                                              | allowed, subject to current identity validation | allowed only for approved owner and fields                     | allowed when all adoption checks pass |
| `UNRESOLVED`  | allowed when safely parseable                        | denied                                          | denied; moderation remains a separate trusted operation domain | denied                                |
| `QUARANTINED` | allowed only as explicitly marked compatibility data | denied                                          | denied                                                         | denied                                |

The reducer and migration adapter fail closed for authority but fail open for
safe read compatibility. `UNRESOLVED` and `QUARANTINED` records cannot obtain
authority from an embedded author, current name ownership, earliest payload
timestamp, index, or a later publisher. An explicit V2-native adoption record
may establish authority only through independently verifiable identity and
authorization, with a deterministic audit reference; it cannot assert away
legacy ambiguity.

Phase 1 may implement V2 envelopes and schemas, publisher and wallet
validation interfaces, deterministic reduction for new V2 entities, stable
quarantine reasons, V1 compatibility normalization, derived-index boundaries,
and fail-closed authority tests. It must not enable automatic legacy adoption,
inherit owner authority for non-`APPROVED` entities, or ship a final universal
legacy canonical-publisher rule. Those paths are feature-gated behind an
approved manifest and cutoff.

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
  entityType: 'topic' | 'thread' | 'post';
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

### 19.1 Phase 6 fragment schema and namespaces

Phase 6 replaces active new-V2 whole-directory and whole-thread writes with
one independently rebuildable locator fragment per entity. The strict envelope
is:

```ts
interface V2IndexFragmentEnvelope {
  schema: 'qdb-v2-index';
  schemaVersion: 1;
  kind: 'derived-index-fragment';
  recordType: 'entity-locator';
  recordId: string;
  targetId: string;
  body: {
    entityType: 'topic' | 'thread' | 'post';
    entityId: string;
    parentId: string | null;
    authority: { publisherName: string; identifier: string };
    hint: { title?: string; excerpt?: string };
  };
}
```

Fragments contain only an authority locator, parent locator, and bounded search
hint. They never contain reaction state, native-poll results, moderation, role
state, tip totals, access authority, or a complete entity snapshot.

The enabled namespaces are:

```text
qdbm-v2-idx-t-{entityBucket}-{entityKey}
qdbm-v2-idx-h-{parentTopicBucket}-{entityKey}
qdbm-v2-idx-p-{parentThreadBucket}-{entityKey}
```

`qdbm` is replaced by the configured application namespace. The eight-character
stable bucket partitions thread/post locators by parent. The 14-character
deterministic entity key combines independent hashes of the entity ID and its
reverse, keeping even maximum accepted entity IDs within QDN's 64-character
identifier constraint. The full entity ID remains in the strictly validated
payload. The existing immutable V2 authority namespaces (`qdbm-v2-topic-`,
`qdbm-v2-thread-`, `qdbm-v2-post-`, and `qdbm-v2-edit-`) remain readable.
Independent reaction, moderation, role, tip, and poll domains retain their
already-published identifiers. Entity-type authority prefixes plus
operation-specific prefixes prevent unrelated domains competing in one search;
parent-bucketed fragments make thread/post discovery narrower for new indexes.

Fragment reduction first applies strict schema and identifier validation. Each
candidate resource publisher and its embedded authority locator must match the
accepted V2 entity owner before it may compete for selection; an invalid newer
fragment therefore cannot suppress a valid owner fragment. Eligible candidates
are then selected by trusted Core `updated ?? created`, latest signature,
normalized publisher, and identifier. Entity type, entity ID, parent, canonical
publisher, and authoritative identifier must all agree with the accepted V2
entity. A stale hint is diagnosed and the authoritative entity content is used.
An unavailable, invalid, or tombstoned target does not become an entity through
its fragment.

All normal V2 Topic, Thread, and Post creation and owner-content edit commands
publish a single entity fragment. Reactions, poll votes/updates, moderation,
role changes, and tips publish no entity-index rewrite. The old
`qdbm-index-topics` and `qdbm-index-thread-*` builders/loaders remain only for
V1 compatibility and last-known-good discovery; no active V2 mutation command
publishes them. Active commands update local compatibility caches through pure
snapshot builders and do not serialize or prepare whole-index QDN resources.

### 19.2 Phase 6 search

Search discovers the three fragment families through the shared paginator,
strictly validates them against reduced V2 authority, and matches the accepted
authoritative content rather than fragment hints. Results are ordered by entity
ID after validation. Stale hints can locate authority but cannot create a match
or replace content. Current moderation state excludes removed targets and
hidden targets for non-moderators; unavailable moderation fails search closed.
Partial fragment or authority discovery produces partial search status and a UI
warning. Legacy thread indexes remain readable as
explicit index/cache evidence and as a last-known-good thread fallback; they do
not establish a verified result or authority.

## 20. Partial and unavailable data

Every load result carries:

```ts
type Completeness = 'complete' | 'partial' | 'unavailable';

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

### 20.1 Verified Phase 6 resource-search contract

Phase 6 re-verified Core commit
`c000a0cd4a1ebaaab5aa753f3cd199f3302ff5bf` and Home commit
`a41e5f9678d7f20d7fb77a223c45fddc0096632e` on 2026-07-21.
These commits are traceability points, not frozen targets.

At those commits:

- Home forwards Q-App resource search `service`, identifier, prefix, mode,
  name/exact-name, `limit`, `offset`, `reverse`, metadata, and status fields;
- Home does not currently forward Core's `before` and `after` resource-search
  parameters;
- Core prefix matching is case-insensitive `prefix%`; without prefix mode an
  identifier search is a contains search, so exact lookups also filter the
  returned identifier in the application;
- service and exact-name filters are applied by Core;
- `mode=ALL` exposes all resource keys rather than only the latest resource per
  name/service;
- Core orders resource results by resource `created_when`, descending when
  `reverse=true`, then applies positive SQL `LIMIT` and `OFFSET`;
- no separate documented maximum page size is enforced in this endpoint;
- a non-positive Core limit means no SQL limit, but the application never uses
  that unbounded mode at runtime;
- results can include service, name, identifier, `created`, nullable `updated`,
  latest signature, metadata, and status when requested;
- one current result represents each `(service, name, identifier)` resource
  key, while live changes between offset requests can still cause overlap;
- Home/Core request errors reject the request rather than returning a typed
  pagination cursor or total count.

Core's primary ordering column does not add a documented stable tie-break for
equal creation timestamps, and offset paging is not snapshot-isolated while new
resources arrive. The client therefore sorts/deduplicates deterministically,
detects repeated pages, and reports partial state on any anomaly; it does not
claim stronger snapshot consistency than the platform supplies.

### 20.2 Shared pagination result and budgets

All production `SEARCH_QDN_RESOURCES` calls use the shared paginator and retain:

```ts
interface QdnDiscoveryResult<T> {
  items: T[];
  completeness: 'complete' | 'partial' | 'unavailable';
  pagesFetched: number;
  resourcesSeen: number;
  stoppedReason:
    | 'exhausted'
    | 'page-budget'
    | 'resource-budget'
    | 'repeated-page'
    | 'request-failed'
    | 'malformed-response';
  diagnostics: PaginationDiagnostic[];
}
```

The runtime defaults are 100 resources per page, 100 pages, 10,000 unique
resources, one repeated-page occurrence, and two paginator retries with
150/300 ms linear backoff. The existing bridge client also performs its bounded
read retries. One hundred is a conservative request size for interactive Q-App
traffic; the 10,000-resource/100-page ceiling is ten times the removed V1 cap
while bounding browser memory, network fan-out, and malicious namespace cost.
Roles and tips use the same 10,000-resource ceiling. Narrow Q-Tube resolution
uses the same primitive with a deliberate 100-resource media-variant budget.

An empty first page is `complete` with zero items. A failed/malformed first page
is `unavailable`. A later failure, page/resource budget, or loop preserves valid
earlier items but is `partial`. Combining partitions is unavailable only when
all partitions are unavailable and none yielded data; otherwise any incomplete
partition makes the combined result partial. Repeated resource keys are merged
by trusted Core ordering and diagnosed.

Payload fetching uses bounded concurrency. A discovered V2 authority payload
that is unavailable or lacks required trusted metadata downgrades V2 discovery
to partial even if metadata pagination exhausted normally. Owner edits,
moderation writes, tip submission/recipient resolution, and native-poll writes
force a fresh complete authority load and fail closed on partial state. Cached
authority is used only for read performance.

### 20.3 Current/cache/index UI states

Runtime entities carry one of `verified-current`, `partial`,
`cached-last-known-good`, `index-only`, or `unavailable`, plus QDN/index/cache
provenance. Direct V1 payloads are explicitly marked `legacy-v1`; only reduced
V2 entities use authoritative-QDN provenance. The authoritative forum structure and direct Post discovery are
always attempted before legacy indexes. The bootstrap uses a legacy directory
only when the authoritative read fails, marks it index-only/read-only, and
shows a non-intrusive warning. Thread post cache and thread-index fallback are
similarly marked; a fresh authoritative result supersedes them.

Current cache horizons are deliberately bounded implementation details:

- 30 seconds for read-only reduced V2 authority;
- 30 seconds for validated V2 index fragments keyed to the reduced authority
  state;
- 30 seconds for the expensive paginated legacy Post discovery/fetch set;
- 30 seconds for forum structure;
- 15 seconds for the in-memory legacy topic directory;
- six hours for legacy thread-index last-known-good storage;
- five minutes before local thread Post cache is considered stale.

Authority-sensitive commands bypass the V2 authority cache. Cached/index-only
Topic or Thread state cannot authorize child creation, owner mutation,
moderation, roles, tips, poll writes, or ownership. Cache refresh failure keeps
last-known-good display data instead of erasing it; a successful verified read
replaces the cache.

### 20.4 Stable Phase 6 diagnostics

Phase 6 defines:

- `PAGINATION_INCOMPLETE`;
- `PAGINATION_BUDGET_REACHED`;
- `PAGINATION_LOOP_DETECTED`;
- `PAGINATION_REQUEST_FAILED`;
- `DUPLICATE_RESOURCE`;
- `INVALID_INDEX_ENTRY`;
- `STALE_INDEX_ENTRY`;
- `INDEX_TARGET_UNAVAILABLE`;
- `INDEX_AUTHORITY_MISMATCH`;
- `INVALID_PARENT_RELATION`;
- `CACHED_LAST_KNOWN_GOOD`;
- `AUTHORITATIVE_RESOURCE_UNAVAILABLE`;
- `PARTIAL_DISCOVERY`;
- `NAMESPACE_BUDGET_PRESSURE`.

Expected complete empty results do not emit warnings.

## 21. Native poll reference architecture

### 21.1 Invariant

Core is authoritative for a native poll's identity, definition, schedule,
options, votes, closure, and results. A Post stores only a validated reference
and optional non-authoritative display cache. Voting never republishes a Post.

### 21.2 Currently verified capability

The Phase 3 implementation re-verified Core commit
`c000a0cd4a1ebaaab5aa753f3cd199f3302ff5bf` and Home commit
`a41e5f9678d7f20d7fb77a223c45fddc0096632e` on 2026-07-21. These
commits are traceability points, not frozen capability targets.

At that Core commit:

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

Core option indexes are one-based. Zero removes a vote, duplicate/invalid
indexes are rejected, and multiple selections are normalized. Discussion
Boards Phase 3 intentionally does not expose vote removal. It submits one or
more positive indexes according to the Post reference's UI selection policy.

`GET /polls/id/{pollId}` is the authoritative definition/status read and
`GET /polls/votes/id/{pollId}` is the authoritative results/current-voter
read. `totalVotes` is displayed as raw option selections and `totalVoters` as
unique voters. The current UI does not present weighted results; it preserves
the returned effective/raw weight fields in runtime state so a future UI cannot
mistake a client percentage for Core weighting.

Core currently permits an owner-only `UPDATE_POLL`, but closure is not a
general moderation operation. Once votes exist, definition/start/options must
remain unchanged and an existing future end may only be extended. Before votes
exist, the owner may schedule an earlier future end. Phase 3 therefore exposes
only owner scheduling before votes and never claims that a moderator can close
an active voted poll. Normal closure is the authoritative Core `endTime`.

At the recorded Home commit:

- `CREATE_POLL`, `VOTE_ON_POLL`, and `UPDATE_POLL` are bridge actions;
- creation accepts start and end scheduling fields;
- voting accepts `optionIndexes` as well as a single `optionIndex`;
- write responses return `transactionSignature`;
- Home handles approval, unsigned construction, signing, processing, and
  capability-gated public-node poll writes.

Local-node writes use the configured Core write endpoints. Public-node writes
require a zero fee and use the public poll capability response's MemoryPoW
difficulty. Discussion Boards sends `fee: 0`; Home remains responsible for
choosing the local or public path, approval, signing, MemoryPoW, and processing.
All three write actions return a transaction signature.

Home does not currently expose a separate poll-read bridge action. QDN apps are
rendered from the configured Core origin, with same-origin access preserved,
so Phase 3 reads `/polls/...` from the current origin (or an explicitly
configured `VITE_QORTIUM_CORE_API_URL` during development). This is a verified
implementation detail that must be re-checked before a future poll migration
slice; the architectural invariant is authoritative Core reads, not this URL
mechanism.

This is newer than issue #1's historical observation that Home creation omitted
start time and voting exposed only one option. The historical observation
describes the bridge version reviewed then, not the current reference.

### 21.3 V2 native poll reference

The persisted Post field is:

```ts
interface NativePollReference {
  kind: 'native';
  schema: 'qdb-native-poll';
  schemaVersion: 1;
  pollId: number;
  pollName: string;
  creatorName: string;
  creatorAddress: string;
  creationSignature: string;
  provenance: 'qortium-core';
  status: 'confirmed';
  displayCache: {
    question: string;
    description: string;
    selectionMode: 'single' | 'multiple';
    options: Array<{ index: number; label: string }>;
    startsAt: string | null;
    closesAt: string | null;
  };
}
```

The cache contains no votes, results, weights, closure transaction state, or
current-voter state. It preserves minimal readable/searchable context while
Core is unavailable. On a successful read, the Core definition/options/schedule
and Core result model replace cached display values at runtime. A mismatch of
poll ID, poll name, or owner is `POLL_IDENTITY_MISMATCH` and is not silently
reconciled.

The app stores its question, explanatory text, and single/multiple UI policy in
a versioned JSON definition inside the native Core poll description. Core
remains authoritative for that description. The single-choice value is a
Discussion Boards UI policy; current Core itself accepts multi-index votes, so
clients must not describe single choice as a consensus restriction.

The V2 Post create envelope may contain this strict reference. Owner edits do
not allow `pollReference` changes. Poll votes/updates are native transaction
operations and never enter the Post reducer or republish a Post snapshot.

### 21.4 Creation, recovery, and reads

Creation order is deterministic and fail closed:

1. allocate the future Post ID and derive `qdb-{postId}` as the poll name;
2. verify the current Qortium name-to-authenticated-wallet binding;
3. submit `CREATE_POLL` and retain its transaction signature;
4. query Core by poll name (or known ID) and require a positive `pollId`, the
   expected poll name, owner address, app definition, option order, and
   schedule;
5. only after confirmation, publish the V2 Post containing the reference;
6. publish the V1 compatibility snapshot and derived indexes, with only the
   native reference and no runtime result state.

There is no currently verified direct create-signature-to-poll-ID response in
Home. Confirmation therefore binds the deterministic name and expected owner
to a Core poll while retaining the returned creation signature as traceability
evidence. Future phases must re-verify whether a stronger transaction-to-poll
lookup has become available.

`creatorName` records the verified QDN context at creation; native update
authority remains the Core poll owner address. A later current name is accepted
only when it resolves to the authenticated owner address. The name field alone
never grants poll authority.

If creation is submitted but not yet visible, the command returns
`native-poll-confirmation` plus a versioned recovery record. Retrying queries
the existing poll and never creates a second one. If the poll is confirmed but
V2 Post publication fails, `poll-reference` records the orphan-safe,
retryable state. If V2 succeeds and compatibility/index publication fails, V2
authority remains committed under the existing Phase 1 partial-success rules.
No path falls back to an embedded authoritative poll.

An existing reference with an unavailable Core poll remains readable using
its explicitly non-authoritative cache, reports `NATIVE_POLL_UNAVAILABLE`, and
disables voting/update. A submitted vote/update whose result refresh fails
returns its transaction signature with retryable `poll-result-refresh`; it
does not roll back the native transaction or mutate the Post.
If a local thread-cache write fails after a confirmed vote/update, the command
returns successful native authority with retryable `derived-index`; cache
failure cannot turn into a Post or poll-authority rollback.

### 21.5 Legacy boundary and diagnostics

V1 embedded poll definitions and historical vote arrays remain readable and
are labelled read-only. They are not converted to authenticated native votes,
not combined with native counts, and never override a native reference.
Malformed objects that mix native markers with legacy fields are rejected
rather than treated as legacy.

Stable Phase 3 diagnostics are:

- `MALFORMED_POLL_REFERENCE`;
- `MISSING_POLL_ID`;
- `NATIVE_POLL_UNAVAILABLE`;
- `INVALID_OPTION_SELECTION`;
- `UNSUPPORTED_CAPABILITY`;
- `POLL_CREATION_FAILED`;
- `POLL_REFERENCE_PUBLICATION_FAILED`;
- `POLL_VOTE_FAILED`;
- `POLL_UPDATE_REJECTED`;
- `POLL_IDENTITY_MISMATCH`;
- `INCONSISTENT_LEGACY_NATIVE_POLL`.

Derived thread indexes may cache the strict reference only. Runtime Core
results are stripped before compatibility or index publication. Index content
cannot create, mutate, or replace Post or poll authority. Before a native vote
or update, the command reloads the V2 Post with trusted QDN metadata/current
V2 identity validation and requires its reference to match the displayed
reference; an index-only or compatibility-only reference cannot authorize a
poll transaction.

### 21.6 Future re-verification

Before any later poll migration or feature extension, re-check:

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

Phase 5 re-verified Core commit
`c000a0cd4a1ebaaab5aa753f3cd199f3302ff5bf` and Home commit
`a41e5f9678d7f20d7fb77a223c45fddc0096632e` on 2026-07-21. They are
traceability points, not frozen capability targets.

At the recorded Home commit, `SEND_COIN` with `coin: 'QORT'` selects the native
asset transfer path. Home builds and processes a `TRANSFER_ASSET` transaction
with `assetId: 0`; it does **not** produce the older `PAYMENT` transaction type.
The successful bridge response contains `accepted`, action, recipient, amount,
asset metadata, processed result, and `transactionSignature`. This newer
verified behavior supersedes older issue wording that used “PAYMENT” as the
expected Core type. Cancellation and processing failure reject the bridge
request and do not yield a usable signature.

At the recorded Core commit,
`GET /transactions/signature/{signature}` returns the transaction type,
signature, creator address, recipient, atomic QORT amount exposed through the
amount adapter, `assetId`, timestamp, block height/sequence, and approval
status. `blockHeight` is absent for an unconfirmed transaction. Approval status
is one of `NOT_REQUIRED`, `PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`, or
`INVALID`. Phase 5 accepts only a positive block height and `NOT_REQUIRED` or
`APPROVED`; pending/unconfirmed evidence remains retryable and rejected,
expired, invalid, missing, or structurally inconsistent evidence is not
counted. These response fields and confirmation semantics must be re-verified
against then-current Core/Home before any later tip migration.

### 22.3 Reference schema and publication authority

The independent operation is:

```ts
interface TipReference {
  schema: 'qdb-v2';
  schemaVersion: 2;
  kind: 'operation';
  recordType: 'tip-reference';
  recordId: string;
  targetId: string;
  body: {
    operation: 'tip-reference';
    targetType: 'post';
    targetId: string;
    transactionSignature: string;
    senderName: string;
    senderAddress: string;
    recipientName: string;
    recipientAddress: string;
    amountQort: string; // canonical positive decimal with eight places
  };
  clientCreatedAt?: string;
}
```

The body contains claims and a transaction locator, not payment authority. Only
the verified payment sender may publish the canonical reference. On reload,
the reference's immutable `ARBITRARY`/`PUT` publication transaction must match
the QDN latest signature, resource creation time, name, identifier, and claimed
sender wallet. Current name ownership is used only as a write-time safety check;
the immutable transaction creator address is the reload-time publisher-wallet
evidence. Historical name ownership is neither available nor inferred.

The canonical identifier is
`qdbm-v2-tip-{sha256(transactionSignature)[0:40]}`. It is independent of Post,
publisher, and client timestamp, stays within the currently verified
64-character QDN constraint, and gives one global identity to one payment.
Before a retry publishes, exact sender/identifier discovery checks whether the
immutable reference already exists. An existing resource is reloaded, never
overwritten merely because its transaction or payload is still propagating.

### 22.4 Verification, reduction, and deduplication

A reference participates only when all of the following hold:

1. strict envelope and trusted QDN metadata validation succeeds;
2. the identifier is the canonical hash of the referenced signature;
3. the resource is immutable (`updated` is null) and its confirmed publication
   transaction proves sender publication;
4. the target is an authoritative V2 Post;
5. the reference recipient name/address exactly matches that Post's immutable
   publisher/wallet authority;
6. Core returns the exact signature as a confirmed native-QORT
   `TRANSFER_ASSET` with `assetId: 0`;
7. transaction creator, recipient, and canonical eight-decimal amount exactly
   match the reference.

The signature is deduplicated globally. Identical rediscovery counts once;
conflicting independently valid target/metadata claims quarantine the signature
instead of selecting one. Unauthorized or invalid duplicates cannot suppress a
valid reference. Multiple distinct payment signatures for one Post are
independent and cannot overwrite the Post or one another.

Verified activity orders by trusted block height, block sequence, signed
payment timestamp, then transaction signature. QDN creation/signature/identifier provide
deterministic reference diagnostics and tie-break evidence. `clientCreatedAt`,
Post `updatedAt`, mutable counters, indexes, and discovery order never rank a
payment or establish authority.

Derived state contains unique verified count, exact total QORT, and individual
verified references. It is rebuilt from reference and Core transaction evidence
on reload. Index/cache data is optional display acceleration only and cannot
create, redirect, alter, or count a tip. Phase 5 uses bounded paged discovery
for this security-sensitive operation family; the general index and pagination
redesign remains Phase 6.

### 22.5 Command order, recovery, and compatibility

The runtime order is fixed:

1. load the authoritative V2 Post and its immutable owner wallet;
2. verify the selected sender account and a fresh current sender name/wallet
   binding;
3. submit `SEND_COIN` once and preserve its signature immediately;
4. verify the confirmed Core transaction;
5. publish the independent reference;
6. rediscover, reverify, reduce, and refresh derived display/cache state.

No failure after step 3 automatically repeats `SEND_COIN`. Structured outcomes
distinguish payment failure, payment success with transaction verification
pending, verified payment with reference publication pending, reference refresh
pending, and derived-cache refresh pending. The recovery record retains target,
signature, sender, recipient, amount, and canonical record ID; retry executes
only verification/reference/cache work. A reference already found under the
sender's canonical identifier is never republished.
Retryable recovery records are also retained in non-authoritative local storage
by Post ID so a UI reload does not discard the payment signature. Corrupt local
recovery data is ignored, and local storage never proves a payment or reference.

Tips do not modify or republish Post content, publisher/ownership, reactions,
poll state, moderation, roles, or entity timestamps. The active V1
`Post.tips + 1` snapshot/index publication path is removed. Existing `Post.tips`
integers remain readable as **legacy historical, unverified counters**. The UI
shows them separately from verified count/total; the two values are never
summed and no historical QORT amount is fabricated. A legacy/unavailable Post
without authoritative V2 owner-wallet state cannot select a tip recipient.

Stable diagnostics are `TIP_MALFORMED_REFERENCE`, `TIP_MISSING_SIGNATURE`,
`TIP_TRANSACTION_NOT_FOUND`, `TIP_WRONG_TRANSACTION_TYPE`,
`TIP_TRANSACTION_INVALID`, `TIP_SENDER_MISMATCH`, `TIP_RECIPIENT_MISMATCH`,
`TIP_AMOUNT_MISMATCH`, `TIP_TARGET_MISMATCH`, `TIP_TARGET_UNAVAILABLE`,
`TIP_DUPLICATE_REFERENCE`, `TIP_REFERENCE_CONFLICT`,
`TIP_UNAUTHORIZED_PUBLISHER`, `TIP_WALLET_NAME_UNAVAILABLE`,
`TIP_VERIFICATION_UNAVAILABLE`, `TIP_REFERENCE_PUBLICATION_FAILED`,
`TIP_DERIVED_CACHE_FAILED`, `TIP_LEGACY_UNVERIFIED`,
`TIP_IDENTIFIER_MISMATCH`, `TIP_REFERENCE_TRANSACTION_MISMATCH`,
`TIP_REFERENCE_REPUBLISHED`, `TIP_REFERENCE_UNAVAILABLE`,
`TIP_MISSING_TRUSTED_METADATA`, and `TIP_DISCOVERY_INCOMPLETE`.

## 23. Moderation and role boundaries

Phase 4 implements moderation as an independent append-only operation domain.
It does not alter the entity reducer, owner content, reaction state, native poll
state, tips, ownership, or role data.

### 23.1 Verified platform and role boundary

Phase 4 re-verified Qortium Core commit
`c000a0cd4a1ebaaab5aa753f3cd199f3302ff5bf` and Qortium Home commit
`a41e5f9678d7f20d7fb77a223c45fddc0096632e`.

The current Home bridge passes `service`, `name`, `identifier`, Core `created`,
`updated`, `latestSignature`, and resource status through QDN search. It also
supports exact/prefix discovery, resource fetch and publication. Its read-only
`FETCH_NODE_API` route can retrieve the immutable transaction for a QDN latest
signature. At the referenced Core commit,
`/transactions/signature/{signature}` exposes ARBITRARY method, timestamp,
signature, creator address, name, identifier, block height, and block sequence.
These response details are currently verified implementation facts and must be
re-checked before later migration work.

Historical QDN name ownership is still unavailable. Current name ownership
must not be substituted for it. Issue #7 therefore binds each new immutable
role operation to the Core transaction creator address at publication time.
This is stronger evidence than an embedded actor or a current ownership lookup.

The fixed primary SysOp wallet
`QN1XYwwmTzXemusDb9p7T1nKJEACLHGgaL` remains the trust root. Existing role
assignments bootstrap from the latest canonical `qdbm-roles-default` resource
whose publisher is currently among that wallet's QDN names **and** whose latest
Core transaction proves that the fixed wallet published the selected resource
revision. Name-cache staleness cannot make a transferred name authoritative.
If no primary-owned registry exists, the fixed primary alone is the verified
bootstrap. Complete role-specific discovery is paged in trusted order; hitting
the 5,000-resource safety budget makes role state unavailable rather than
silently truncating it.

The role interface remains `VERIFIED`, `UNVERIFIED`, or `UNAVAILABLE`; only
`VERIFIED` authorizes role or moderation writes. Missing discovery, payload,
transaction evidence, or bootstrap proof fails closed. Delegated legacy
full-registry snapshots are reported as
`ROLE_LEGACY_DELEGATED_SNAPSHOT_IGNORED` and remain historical evidence only.
They never enter the trusted state.

### 23.2 Authoritative role-operation history

Issue #7 selects independent append-only role operations over a
primary-SysOp-owned legacy bootstrap. A primary-only snapshot would not provide
real delegated administration, while trusting delegated snapshots would allow
whole-state replacement. A proposal/approval workflow is not required because
current Core transaction evidence can bind each immutable operation to its
publisher wallet. The selected model provides delegated persistence,
prior-state authorization, deterministic reduction, and a historical audit.

Each `qdbm-v2-role-*` resource contains one strict operation:

```ts
interface RoleOperation {
  operation: 'role-change';
  action: 'assign' | 'revoke';
  targetAddress: string;
  role: 'Moderator' | 'Admin' | 'SuperAdmin';
  actorName: string;
  actorAddress: string;
  prior: {
    bootstrapIdentifier: string | null;
    bootstrapSignature: string | null;
    previousOperationId: string | null;
    previousOperationSignature: string | null;
  };
  reason?: string;
}
```

The envelope is `qdb-v2`, schema version 2, `kind: 'operation'`, and
`recordType: 'role-change'`; `targetId` equals `targetAddress` and the trusted
identifier equals `recordId`. Unknown fields, mutable resource revisions, and
SysOp as a delegable role are rejected. Operations order only by trusted Core
`created`, then latest signature, identifier, and publisher. Client dates and
legacy `updatedAt` do not participate.

The reducer starts with the trusted bootstrap checkpoint. Every operation must
name that checkpoint and the immediately preceding accepted operation. It is
then authenticated and authorized against the role state that existed before
it. Accepted operations alone advance the checkpoint. Concurrent branches from
one checkpoint resolve deterministically: the first trusted-order branch wins
and stale branches fail `ROLE_LINEAGE_MISMATCH` for explicit retry. Repeated
assignment and revocation are idempotent; conflicting reuse of one
publisher/identifier is quarantined.

The enforced role-change matrix is:

| Actor              | Assign/revoke SuperAdmin | Assign/revoke Admin | Assign/revoke Moderator |
| ------------------ | ------------------------ | ------------------- | ----------------------- |
| SysOp              | yes                      | yes                 | yes                     |
| SuperAdmin         | no                       | yes                 | yes                     |
| Admin              | no                       | no                  | yes                     |
| Moderator / Member | no                       | no                  | no                      |

No actor may change their own role, a peer/higher target, or a role equal to or
above their own. The primary SysOp cannot be removed, replaced, or transferred.
A role operation never carries a full registry snapshot.

Before publication, the command verifies the current actor name/wallet binding
and the current trusted checkpoint. On reload, the immutable transaction must
match resource signature, timestamp, name, identifier, and claimed actor
wallet. This transaction-time evidence—not the actor payload—supports
historical reduction. Successful publication followed by refresh/discovery
failure returns retryable `role-state-refresh` partial success and never rolls
back authority. Publication failure does not change local trusted state. No
compatibility registry or index write is required for a role operation.

Stable role diagnostics include `MALFORMED_ROLE_OPERATION`,
`ROLE_FORGED_ACTOR`, `ROLE_PUBLISHER_WALLET_MISMATCH`,
`ROLE_UNTRUSTED_PUBLISHER`, `ROLE_INSUFFICIENT_PRIOR_ROLE`,
`ROLE_SELF_ESCALATION_ATTEMPT`, `ROLE_FORBIDDEN_ASSIGNMENT`,
`ROLE_FORBIDDEN_REVOCATION`, `ROLE_TARGET_HIERARCHY_VIOLATION`,
`ROLE_TARGET_ROLE_MISMATCH`, `ROLE_PROTECTED_SYSOP_MUTATION`,
`ROLE_OPERATION_CONFLICT`, `ROLE_LINEAGE_MISMATCH`,
`ROLE_IDENTIFIER_MISMATCH`, `ROLE_TRANSACTION_MISMATCH`,
`ROLE_RESOURCE_REPUBLISHED`, `ROLE_RESOURCE_UNAVAILABLE`,
`ROLE_TRANSACTION_UNAVAILABLE`, `ROLE_NAME_WALLET_UNAVAILABLE`,
`ROLE_MISSING_TRUSTED_METADATA`,
`ROLE_LEGACY_DELEGATED_SNAPSHOT_IGNORED`,
`ROLE_OPERATION_PREDATES_BOOTSTRAP`, `ROLE_BOOTSTRAP_TRUST_FAILURE`, and
`ROLE_DISCOVERY_INCOMPLETE`.

### 23.3 Operation schema and identifiers

```ts
interface ModerationOperation {
  operation: 'moderation';
  action:
    | 'pin'
    | 'unpin'
    | 'lock'
    | 'unlock'
    | 'solve'
    | 'unsolve'
    | 'hide'
    | 'unhide'
    | 'remove'
    | 'restore'
    | 'set-order';
  targetType: 'topic' | 'thread' | 'post';
  targetId: string;
  actorName: string;
  actorAddress: string;
  authorization: {
    model: 'v2-role-operation-history';
    actorRole: 'Member' | 'Moderator' | 'Admin' | 'SuperAdmin' | 'SysOp';
    bootstrapIdentifier: string | null;
    bootstrapSignature: string | null;
    previousOperationId: string | null;
    previousOperationSignature: string | null;
  };
  reason?: string;
  orderValue?: number; // non-negative integer; set-order only
}
```

The surrounding V2 envelope has `kind: 'operation'` and
`recordType: 'moderation'`. The trusted QDN identifier must exactly equal the
envelope `recordId`. New identifiers use
`qdbm-v2-mod-moderation_<time><actor-hash>_<random>` and remain under the
currently verified 64-character Core limit. Each operation contains only one
moderation intent. Strict unknown-field rejection prevents content, reactions,
polls, tips, authority, or role state from being smuggled into the operation.

### 23.4 Permission and hierarchy rules

| Target/action                                  | Member | Moderator | Admin | Super Admin | SysOp |
| ---------------------------------------------- | -----: | --------: | ----: | ----------: | ----: |
| Topic lock/unlock, hide/unhide, remove/restore |     no |        no |   yes |         yes |   yes |
| Topic order                                    |     no |        no |    no |         yes |   yes |
| Thread lock/unlock, solve/unsolve              |     no |       yes |   yes |         yes |   yes |
| Thread pin/unpin, hide/unhide, remove/restore  |     no |        no |   yes |         yes |   yes |
| Pinned Thread order                            |     no |        no |    no |         yes |   yes |
| Post pin/unpin                                 |     no |       yes |   yes |         yes |   yes |
| Post hide/unhide, remove/restore               |     no |        no |   yes |         yes |   yes |

Regular users have no moderation permission; owner content and future owner
tombstones remain separate owner operation domains. Role management is never a
moderation action.

An actor may moderate their own target where the action is allowed. For a
target owned by different trusted staff, the actor's trusted role at operation
publication order must be strictly higher than the target owner's role at that
same checkpoint. A Moderator therefore
cannot moderate Moderator/Admin/Super Admin/SysOp-owned content; an Admin may
act on Moderator-owned content but not Admin-or-higher content. SysOp remains
the highest role.

For a moderation dimension already decided by a higher role, a later lower
role cannot override it. Equal or higher roles may reverse it in trusted
operation order. This applies independently to pin, lock, solved, visibility,
removal, and order dimensions.

### 23.5 Validation, reduction, and audit

Moderation reduction runs after authoritative V2 entity creation and owner
edits. An operation is accepted only when:

1. strict envelope/body validation succeeds;
2. trusted Core metadata exists and the identifier equals `recordId`;
3. the target exists in authoritative V2 state and its type matches;
4. actual QDN publisher equals `actorName`;
5. current name-to-wallet binding equals `actorAddress`;
6. trusted role state is `VERIFIED`, the operation references the immediately
   preceding trusted role checkpoint, and the role at that historical point
   equals the audit claim;
7. the role may perform the target/action and staff hierarchy rules pass.

Moderation identifiers are append-only: a resource with non-null Core
`updated` is excluded as `MODERATION_RESOURCE_REPUBLISHED` rather than letting
an actor rewrite a past operation. Valid records order by Core `created`, then
`latestSignature`, identifier, and publisher. `clientCreatedAt` and legacy
`updatedAt` are display-only. Exact duplicate discovery is idempotent.
Different records reusing one `recordId` are all excluded with
`MODERATION_CONFLICT`. Each state dimension retains the winning action, actor
name/address/role, reason, trusted creation time, signature, and identifier so
state is auditable without a log UI.

Legacy Phase 4 moderation envelopes using
`current-primary-registry-revalidation` remain valid only when they order after
the trusted bootstrap and before the first accepted V2 role operation, and
their registry identifier/signature match that bootstrap. Later V2 role
changes do not invalidate a prior accepted moderation operation. A revoked
actor cannot publish a new action because its immediately preceding historical
checkpoint resolves to `Member` (or another insufficient role). A later grant
cannot authorize an earlier operation.

Stable diagnostics include:

- `MALFORMED_MODERATION_ENVELOPE`;
- `MODERATION_INVALID_TARGET` and `MODERATION_TARGET_TYPE_MISMATCH`;
- `MODERATION_IDENTIFIER_MISMATCH`;
- `MODERATION_FORGED_ACTOR` and `MODERATION_WALLET_BINDING_MISSING`;
- `MODERATION_INSUFFICIENT_ROLE`, `MODERATION_ROLE_REVOKED`, and
  `MODERATION_ROLE_CLAIM_MISMATCH`;
- `MODERATION_ROLE_STATE_UNVERIFIED` and
  `MODERATION_ROLE_STATE_UNAVAILABLE`;
- `MODERATION_FORBIDDEN_FIELD` and `MODERATION_UNSUPPORTED_ACTION`;
- `MODERATION_PRECEDENCE_DENIED` and `MODERATION_CONFLICT`;
- `MODERATION_RESOURCE_REPUBLISHED`;
- `MODERATION_RESOURCE_UNAVAILABLE` and
  `MODERATION_MISSING_TRUSTED_METADATA`;
- `MODERATION_LEGACY_TARGET_BLOCKED` for an attempted full-snapshot legacy
  moderation mutation; and
- `MODERATION_PUBLICATION_FAILED` when the authoritative operation itself was
  not published.

### 23.6 Legacy precedence and failure recovery

Legacy pinned, locked, solved, visibility, deletion, and audit fields remain a
readable compatibility baseline. Derived indexes can carry that baseline but
cannot create an operation, role, or V2 target authority. Where an accepted V2
operation exists for a dimension, its reduced state overlays the legacy/index
value. A later legacy snapshot or index cannot override it. An unavailable
moderation domain leaves readable legacy display state in place but never
authorizes a mutation.

New active moderation commands publish independent V2 records and never use a
legacy full-snapshot fallback. Topic order, pinned-Thread order, Topic/Thread
lock and visibility, Thread pin and solved state, Post pinning, and staff Post
removal are wired to this boundary. Mixed owner fields use the existing V2
owner-edit path; parent/access/poll configuration remains feature-gated rather
than being mislabeled as moderation. The old legacy Post deletion service is
explicitly blocked.

Operation publication is authoritative independently of compatibility and
indexes. If the operation succeeds but a derived index update fails, the
command reports retryable partial success and retains moderation authority. If
operation publication fails, no legacy moderation snapshot is published. A
multi-target ordering command can similarly report that a prefix of independent
operations committed and requires reload before retry.

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
   deterministic reducer, quarantine, V1 reader, and explicit legacy
   authority states. Automatic legacy authority migration is feature-gated,
   not a Phase 1 prerequisite.
3. **Phase 2 (#4):** independent authenticated reactions.
4. **Phase 3 (#5):** native Core polls and Home bridge writes.
5. **Phase 4 (#6):** moderation operations and role authorization redesign.
6. **Phase 5 (#8):** verified transaction-based tips (implemented).
7. **Phase 6 (#10):** paginated QDN discovery, explicit partial/unavailable
   state, validated rebuildable fragments, and read-only last-known-good
   compatibility (implemented).
8. Correct restricted-access/privacy terminology.
9. **Delegated-role persistence (#7):** append-only authenticated role
   operations over the trusted legacy bootstrap (completed before Phase 5).
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
18. zero, boundary, multi-page, greater-than-1,000, duplicate, failed,
    repeated, page-budget, resource-budget, and prefix-flooded QDN discovery;
19. valid, stale, malformed, poisoned, conflicting, wrong-authority,
    wrong-parent, unavailable, tombstoned, and index-only V2 fragments;
20. verified-current, partial, cached-last-known-good, index-only, and
    unavailable UI/query states;
21. last-known-good cache with unavailable authoritative resource;
22. current-name transfer/historical-wallet ambiguity;
23. malformed/oversized payload and attachment references;
24. `APPROVED`, `UNRESOLVED`, and `QUARANTINED` legacy entities proving that
    only approved mappings can authorize owner edits, adoption, transfer, or
    destructive operations;
25. safe compatibility rendering when authority metadata is missing, partial,
    unavailable, or conflicting;
26. new V2-native entities proving they do not depend on legacy canonicalization.

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
- unresolved legacy publisher authority remains readable but cannot authorize
  V2 owner-sensitive mutations or adoption.

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
- unresolved and quarantined legacy fixtures cannot gain V2 authority;
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

### 27.4 Phase 6 implementation acceptance

- complete-empty, partial, and unavailable discovery are distinct;
- exact-boundary and greater-than-1,000 fixtures paginate to exhaustion;
- request failure, retry exhaustion, repeated pages, duplicates, and safety
  budgets preserve valid earlier results with stable diagnostics;
- namespace flooding cannot silently turn a capped set into complete state;
- strict fragments reduce identically across page/input permutations;
- malformed, stale, conflicting, unauthorized, wrong-parent, unavailable, and
  tombstoned entries cannot establish or replace authority;
- search matches validated authoritative content and exposes partial state;
- current authority supersedes cache, while cache/index-only data remains
  explicitly read-only;
- normal V2 create/edit/moderation/reaction/poll/role/tip commands do not
  require whole-directory or whole-thread publication;
- legacy identifiers and index snapshots remain readable as compatibility
  evidence;
- prior Architecture V2 suites, rich-text checks, lint/format checks, and the
  production build pass.

## 28. Open decisions

### Blocking automatic legacy authority migration

1. Approval of the constrained earliest-candidate algorithm, V1 cutoff, and
   migration-manifest governance after maintainer fixture review.
2. First-transaction/block evidence and historical wallet binding for any
   mapping a maintainer wishes to mark `APPROVED`; current name ownership is
   insufficient.

### Deferred to their workflow phases

1. Native poll UI result model and create-signature-to-poll-ID resolution.
2. A future, explicitly reviewed SysOp-transfer mechanism. The fixed trust root
   is intentionally immutable in the current role-operation model.
3. Encryption design, if true confidentiality is ever required.
4. Large-file source-token behavior on every supported Home platform.

Deferred decisions may not violate the invariants in section 3.
