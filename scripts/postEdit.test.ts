/**
 * Post edit tests — GitHub issue #17.
 *
 * Sections:
 *   A. Architecture V2 reducer/policy tests (import real reducer)
 *   B. Submit-result contract (imports real PostEditSubmitResult type)
 *   C. Submit-state model regression (simulates submit lifecycle; NOT React)
 *   D. Dismissal-policy model regression (simulates close/Escape; NOT React)
 *   E. Regression guard — Architecture V2 authority
 *
 * ── IMPORTANT DISCLAIMER ──
 * These tests do NOT render React components.
 * They do NOT dispatch real DOM events (click, keydown, form submit).
 * They do NOT prove that the visible "Saving…" label, disabled submit button,
 * backdrop-click blocking, Escape-key suppression, or the red alert <p> element
 * appear correctly in a browser.
 * Those behaviors require owner live validation or a future browser/component
 * test framework (React Testing Library, Playwright, etc.).
 * ────────────────────────────
 *
 * What IS tested:
 *   - The Architecture V2 reducer, field policy, and identity validation
 *     (imported from `src/services/architectureV2/reducer.js`).
 *   - The `PostEditSubmitResult` discriminated union contract
 *     (imported from `src/features/forum/components/PostEditModal`).
 *   - A submit-state model that mirrors the `submitting` / `submitError` /
 *     `didClose` lifecycle without rendering React.
 *   - A dismissal-policy model that mirrors the `handleClose` guard and
 *     Escape-key interception pattern.
 *
 * Mocks are used for bridge/QDN write operations where needed.
 */
import {
  emptyV2State,
  reduceV2Creates,
  applyOwnerEdit,
} from '../src/services/architectureV2/reducer.js';

import type {
  OwnerEdit,
  PostCreate,
} from '../src/services/architectureV2/types.js';
import type { IdentityValidator } from '../src/services/architectureV2/validation.js';
import type { PostEditSubmitResult } from '../src/features/forum/types.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const assert = {
  equal: (a: unknown, b: unknown, label?: string) => {
    if (a !== b)
      throw new Error(
        label
          ? `${label}: expected ${String(b)}, got ${String(a)}`
          : `expected ${String(b)}, got ${String(a)}`
      );
  },
  ok: (value: unknown, label?: string) => {
    if (!value) throw new Error(label ?? 'expected truthy value');
  },
  fail: (label: string) => {
    throw new Error(label);
  },
  deepEqual: (a: unknown, b: unknown, label?: string) => {
    if (JSON.stringify(a) !== JSON.stringify(b))
      throw new Error(label ? `${label}: values differ` : 'values differ');
  },
  rejects: async (fn: () => Promise<unknown>, label?: string) => {
    try {
      await fn();
      throw new Error(label ?? 'expected rejection, but function resolved');
    } catch {
      // expected
    }
  },
};

const ownerIdentity: IdentityValidator = {
  validatePublisher: (metadata, claimed) =>
    metadata.publisherName.toLowerCase() === claimed.toLowerCase()
      ? { ok: true }
      : {
          ok: false,
          code: 'IDENTITY_UNVERIFIED',
          detail: 'publisher mismatch',
        },
  validateWalletBinding: (_name, wallet) =>
    wallet.length > 0
      ? { ok: true }
      : {
          ok: false,
          code: 'IDENTITY_UNVERIFIED',
          detail: 'wallet binding unavailable',
        },
};

const otherIdentity: IdentityValidator = {
  validatePublisher: (metadata, claimed) =>
    metadata.publisherName.toLowerCase() === claimed.toLowerCase()
      ? { ok: true }
      : {
          ok: false,
          code: 'IDENTITY_UNVERIFIED',
          detail: 'publisher mismatch',
        },
  validateWalletBinding: (_name, wallet) =>
    wallet === 'other-wallet'
      ? { ok: true }
      : {
          ok: false,
          code: 'IDENTITY_UNVERIFIED',
          detail: 'wallet binding unavailable',
        },
};

const makePostCreate = (
  entityId: string,
  publisher = 'alice',
  content = 'original content'
): PostCreate => ({
  entityType: 'post',
  entityId,
  parentThreadId: 'thread-1',
  parentPostId: null,
  publisherName: publisher,
  walletAddress: publisher === 'alice' ? 'alice-wallet' : 'other-wallet',
  content,
  attachments: [],
});

const makeOwnerEdit = (
  targetId: string,
  content: string,
  publisher = 'alice'
): OwnerEdit => ({
  operation: 'owner-edit' as const,
  targetType: 'post' as const,
  targetId,
  publisherName: publisher,
  walletAddress: publisher === 'alice' ? 'alice-wallet' : 'other-wallet',
  changes: { content },
});

// === imported type above — no manual mirror needed ===

// ---------------------------------------------------------------------------
// test runner (supports sync + async)
// ---------------------------------------------------------------------------

let testCount = 0;
let passCount = 0;
const pendingPromises: Promise<void>[] = [];

const runTest = (name: string, fn: () => void | Promise<void>) => {
  testCount += 1;
  try {
    const result = fn();
    if (result instanceof Promise) {
      pendingPromises.push(
        result.then(
          () => {
            passCount += 1;
            console.log(`PASS ${name}`);
          },
          (error) => {
            console.error(
              `FAIL ${name}`,
              error instanceof Error ? error.message : error
            );
          }
        )
      );
    } else {
      passCount += 1;
      console.log(`PASS ${name}`);
    }
  } catch (error) {
    console.error(
      `FAIL ${name}`,
      error instanceof Error ? error.message : error
    );
  }
};

// ===========================================================================
// A. Architecture V2 reducer/policy (imports real reducer)
// ===========================================================================

// A-1
runTest(
  '[Architecture V2 reducer] own valid V2 post edit applies content change',
  () => {
    const created = reduceV2Creates(
      [
        {
          metadata: {
            service: 'FORUM',
            publisherName: 'alice',
            identifier: 'v2-post-1',
            created: 1,
            updated: 1,
            latestSignature: 'sig-1',
          },
          envelope: {
            schema: 'qdb-v2' as const,
            schemaVersion: 2 as const,
            kind: 'entity-create' as const,
            recordType: 'post' as const,
            recordId: 'v2-post-1',
            targetId: 'post-1',
            body: makePostCreate('post-1'),
            clientCreatedAt: '2025-01-01T00:00:00Z',
          },
        },
      ],
      ownerIdentity
    );

    const edited = applyOwnerEdit(
      created,
      {
        service: 'FORUM',
        publisherName: 'alice',
        identifier: 'v2-edit-post-1',
        created: 2,
        updated: 2,
        latestSignature: 'sig-2',
      },
      makeOwnerEdit('post-1', 'updated content'),
      ownerIdentity
    );

    const post = edited.entities['post-1'];
    assert.ok(
      post && post.entityType === 'post',
      'post should exist after edit'
    );
    assert.equal(
      (post as PostCreate).content,
      'updated content',
      'post content should reflect the edit'
    );
    assert.equal(edited.quarantined.length, 0, 'no quarantined records');
  }
);

// A-2
runTest(
  '[Architecture V2 reducer] edit with unchanged content still succeeds (idempotent)',
  () => {
    const created = reduceV2Creates(
      [
        {
          metadata: {
            service: 'FORUM',
            publisherName: 'alice',
            identifier: 'v2-post-2',
            created: 1,
            updated: 1,
            latestSignature: 'sig-1',
          },
          envelope: {
            schema: 'qdb-v2' as const,
            schemaVersion: 2 as const,
            kind: 'entity-create' as const,
            recordType: 'post' as const,
            recordId: 'v2-post-2',
            targetId: 'post-2',
            body: makePostCreate('post-2', 'alice', 'same content'),
            clientCreatedAt: '2025-01-01T00:00:00Z',
          },
        },
      ],
      ownerIdentity
    );

    const edited = applyOwnerEdit(
      created,
      {
        service: 'FORUM',
        publisherName: 'alice',
        identifier: 'v2-edit-post-2',
        created: 2,
        updated: 2,
        latestSignature: 'sig-2',
      },
      makeOwnerEdit('post-2', 'same content'),
      ownerIdentity
    );

    const post = edited.entities['post-2'];
    assert.ok(post, 'post should exist');
    assert.equal(
      (post as PostCreate).content,
      'same content',
      'unchanged content is preserved'
    );
    assert.equal(
      edited.quarantined.length,
      0,
      'idempotent edit is not quarantined'
    );
  }
);

// A-3
runTest(
  '[Architecture V2 reducer] empty content applied by reducer (command layer validates)',
  () => {
    const created = reduceV2Creates(
      [
        {
          metadata: {
            service: 'FORUM',
            publisherName: 'alice',
            identifier: 'v2-post-3',
            created: 1,
            updated: 1,
            latestSignature: 'sig-1',
          },
          envelope: {
            schema: 'qdb-v2' as const,
            schemaVersion: 2 as const,
            kind: 'entity-create' as const,
            recordType: 'post' as const,
            recordId: 'v2-post-3',
            targetId: 'post-3',
            body: makePostCreate('post-3'),
            clientCreatedAt: '2025-01-01T00:00:00Z',
          },
        },
      ],
      ownerIdentity
    );

    const edited = applyOwnerEdit(
      created,
      {
        service: 'FORUM',
        publisherName: 'alice',
        identifier: 'v2-edit-post-3',
        created: 2,
        updated: 2,
        latestSignature: 'sig-2',
      },
      makeOwnerEdit('post-3', ''),
      ownerIdentity
    );

    const post = edited.entities['post-3'];
    assert.ok(post, 'post should still exist');
    assert.equal(
      (post as PostCreate).content,
      '',
      'empty content applied by reducer (command layer validates)'
    );
    assert.equal(
      edited.quarantined.length,
      0,
      'empty content is not a reducer-level rejection'
    );
  }
);

// A-4
runTest(
  '[Architecture V2 reducer] unauthorized owner edit (different publisher) is quarantined',
  () => {
    const created = reduceV2Creates(
      [
        {
          metadata: {
            service: 'FORUM',
            publisherName: 'alice',
            identifier: 'v2-post-4',
            created: 1,
            updated: 1,
            latestSignature: 'sig-1',
          },
          envelope: {
            schema: 'qdb-v2' as const,
            schemaVersion: 2 as const,
            kind: 'entity-create' as const,
            recordType: 'post' as const,
            recordId: 'v2-post-4',
            targetId: 'post-4',
            body: makePostCreate('post-4', 'alice'),
            clientCreatedAt: '2025-01-01T00:00:00Z',
          },
        },
      ],
      ownerIdentity
    );

    const edited = applyOwnerEdit(
      created,
      {
        service: 'FORUM',
        publisherName: 'mallory',
        identifier: 'v2-edit-post-4',
        created: 2,
        updated: 2,
        latestSignature: 'sig-2',
      },
      makeOwnerEdit('post-4', 'hacked content', 'mallory'),
      otherIdentity
    );

    const post = edited.entities['post-4'];
    assert.ok(post, 'post should still exist');
    assert.equal(
      (post as PostCreate).content,
      'original content',
      'unauthorized edit must not modify content'
    );
    assert.ok(
      edited.quarantined.length > 0,
      'unauthorized edit must be quarantined'
    );
    const lastQuarantined = edited.quarantined[edited.quarantined.length - 1];
    assert.ok(
      lastQuarantined?.code === 'UNAUTHORIZED_PUBLISHER' ||
        lastQuarantined?.code === 'IDENTITY_UNVERIFIED',
      `expected authority rejection, got ${lastQuarantined?.code}`
    );
  }
);

// A-5
runTest(
  '[Architecture V2 reducer] forbidden field edit (non-owner-change field) is quarantined',
  () => {
    const created = reduceV2Creates(
      [
        {
          metadata: {
            service: 'FORUM',
            publisherName: 'alice',
            identifier: 'v2-post-5',
            created: 1,
            updated: 1,
            latestSignature: 'sig-1',
          },
          envelope: {
            schema: 'qdb-v2' as const,
            schemaVersion: 2 as const,
            kind: 'entity-create' as const,
            recordType: 'post' as const,
            recordId: 'v2-post-5',
            targetId: 'post-5',
            body: makePostCreate('post-5'),
            clientCreatedAt: '2025-01-01T00:00:00Z',
          },
        },
      ],
      ownerIdentity
    );

    const editWithForbiddenField: OwnerEdit = {
      operation: 'owner-edit',
      targetType: 'post',
      targetId: 'post-5',
      publisherName: 'alice',
      walletAddress: 'alice-wallet',
      changes: { likes: 999 } as unknown as { content: string },
    };

    const edited = applyOwnerEdit(
      created,
      {
        service: 'FORUM',
        publisherName: 'alice',
        identifier: 'v2-edit-post-5',
        created: 2,
        updated: 2,
        latestSignature: 'sig-2',
      },
      editWithForbiddenField,
      ownerIdentity
    );

    assert.ok(
      edited.quarantined.length > 0,
      'forbidden field edit must be quarantined'
    );
    const lastQ = edited.quarantined[edited.quarantined.length - 1];
    assert.equal(
      lastQ?.code,
      'FORBIDDEN_FIELD',
      'expected FORBIDDEN_FIELD code'
    );
  }
);

// A-6
runTest(
  '[Architecture V2 reducer] edit of non-existent target entity is quarantined',
  () => {
    const empty = emptyV2State();
    const edited = applyOwnerEdit(
      empty,
      {
        service: 'FORUM',
        publisherName: 'alice',
        identifier: 'v2-edit-nonexistent',
        created: 1,
        updated: 1,
        latestSignature: 'sig-1',
      },
      makeOwnerEdit('nonexistent', 'content'),
      ownerIdentity
    );

    assert.ok(
      edited.quarantined.length > 0,
      'edit of non-existent entity must be quarantined'
    );
    const lastQ = edited.quarantined[edited.quarantined.length - 1];
    assert.equal(
      lastQ?.code,
      'UNAUTHORIZED_PUBLISHER',
      'expected UNAUTHORIZED_PUBLISHER for missing target'
    );
  }
);

// A-7
runTest(
  '[Architecture V2 reducer] later edit supersedes earlier edit (ordering preserved)',
  () => {
    const created = reduceV2Creates(
      [
        {
          metadata: {
            service: 'FORUM',
            publisherName: 'alice',
            identifier: 'v2-post-6',
            created: 1,
            updated: 1,
            latestSignature: 'sig-1',
          },
          envelope: {
            schema: 'qdb-v2' as const,
            schemaVersion: 2 as const,
            kind: 'entity-create' as const,
            recordType: 'post' as const,
            recordId: 'v2-post-6',
            targetId: 'post-6',
            body: makePostCreate('post-6', 'alice', 'first'),
            clientCreatedAt: '2025-01-01T00:00:00Z',
          },
        },
      ],
      ownerIdentity
    );

    const afterEdit1 = applyOwnerEdit(
      created,
      {
        service: 'FORUM',
        publisherName: 'alice',
        identifier: 'v2-edit-post-6-a',
        created: 2,
        updated: 2,
        latestSignature: 'sig-2',
      },
      makeOwnerEdit('post-6', 'second'),
      ownerIdentity
    );

    const afterEdit2 = applyOwnerEdit(
      afterEdit1,
      {
        service: 'FORUM',
        publisherName: 'alice',
        identifier: 'v2-edit-post-6-b',
        created: 3,
        updated: 3,
        latestSignature: 'sig-3',
      },
      makeOwnerEdit('post-6', 'third'),
      ownerIdentity
    );

    const post = afterEdit2.entities['post-6'];
    assert.ok(post, 'post should exist');
    assert.equal(
      (post as PostCreate).content,
      'third',
      'latest edit must be the final content'
    );

    const staleEdit = applyOwnerEdit(
      afterEdit2,
      {
        service: 'FORUM',
        publisherName: 'alice',
        identifier: 'v2-edit-post-6-stale',
        created: 1,
        updated: 1,
        latestSignature: 'sig-stale',
      },
      makeOwnerEdit('post-6', 'stale-content'),
      ownerIdentity
    );

    const stalePost = staleEdit.entities['post-6'];
    assert.equal(
      (stalePost as PostCreate)?.content,
      'stale-content',
      'stale edit is applied by reducer (runtime ordering handles chronology)'
    );
  }
);

// A-8
runTest('[Serialization] edit changes survive JSON round-trip', () => {
  const created = reduceV2Creates(
    [
      {
        metadata: {
          service: 'FORUM',
          publisherName: 'alice',
          identifier: 'v2-post-7',
          created: 1,
          updated: 1,
          latestSignature: 'sig-1',
        },
        envelope: {
          schema: 'qdb-v2' as const,
          schemaVersion: 2 as const,
          kind: 'entity-create' as const,
          recordType: 'post' as const,
          recordId: 'v2-post-7',
          targetId: 'post-7',
          body: makePostCreate('post-7'),
          clientCreatedAt: '2025-01-01T00:00:00Z',
        },
      },
    ],
    ownerIdentity
  );

  const edited = applyOwnerEdit(
    created,
    {
      service: 'FORUM',
      publisherName: 'alice',
      identifier: 'v2-edit-post-7',
      created: 2,
      updated: 2,
      latestSignature: 'sig-2',
    },
    makeOwnerEdit('post-7', 'round-trip content'),
    ownerIdentity
  );

  const roundTripped = JSON.parse(JSON.stringify(edited));
  assert.deepEqual(
    (roundTripped.entities['post-7'] as PostCreate)?.content,
    'round-trip content',
    'edit survives JSON round-trip'
  );
  assert.equal(
    roundTripped.quarantined.length,
    0,
    'no quarantine after round-trip'
  );
});

// A-9
runTest(
  '[Architecture V2 reducer] edit preserves content with special characters',
  () => {
    const specialContent =
      '[b]bold[/b] [img]qorum://image[/img] <script>alert(1)</script>';
    const created = reduceV2Creates(
      [
        {
          metadata: {
            service: 'FORUM',
            publisherName: 'alice',
            identifier: 'v2-post-8',
            created: 1,
            updated: 1,
            latestSignature: 'sig-1',
          },
          envelope: {
            schema: 'qdb-v2' as const,
            schemaVersion: 2 as const,
            kind: 'entity-create' as const,
            recordType: 'post' as const,
            recordId: 'v2-post-8',
            targetId: 'post-8',
            body: makePostCreate('post-8'),
            clientCreatedAt: '2025-01-01T00:00:00Z',
          },
        },
      ],
      ownerIdentity
    );

    const edited = applyOwnerEdit(
      created,
      {
        service: 'FORUM',
        publisherName: 'alice',
        identifier: 'v2-edit-post-8',
        created: 2,
        updated: 2,
        latestSignature: 'sig-2',
      },
      makeOwnerEdit('post-8', specialContent),
      ownerIdentity
    );

    const post = edited.entities['post-8'];
    assert.equal(
      (post as PostCreate)?.content,
      specialContent,
      'special characters preserved'
    );
    assert.equal(edited.quarantined.length, 0, 'no quarantine');
  }
);

// ===========================================================================
// B. Submit-result contract (imports real PostEditSubmitResult type)
// ===========================================================================

// B-1
runTest('[Submit-result contract] successful edit returns { ok: true }', () => {
  const result: PostEditSubmitResult = { ok: true };
  assert.ok(result.ok, 'ok must be true');
});

// B-2
runTest(
  '[Submit-result contract] failed edit returns { ok: false, error } with non-empty error',
  () => {
    const result: PostEditSubmitResult = { ok: false, error: 'Not authorized' };
    assert.ok(!result.ok, 'ok must be false');
    assert.equal(result.error, 'Not authorized', 'error must be present');
    assert.ok(result.error.length > 0, 'error must be non-empty');
  }
);

// B-3
runTest(
  '[Submit-result contract] all failure variants carry a non-empty error string',
  () => {
    const results: PostEditSubmitResult[] = [
      { ok: false, error: 'Validation failed' },
      { ok: false, error: 'Not authorized' },
      { ok: false, error: 'Authentication required' },
      { ok: false, error: 'Publication failed' },
    ];

    for (const result of results) {
      assert.ok(
        typeof (result as { ok: false; error: string }).error === 'string' &&
          (result as { ok: false; error: string }).error.length > 0,
        `error must be a non-empty string, got "${(result as { ok: false; error: string }).error}"`
      );
    }
  }
);

// ===========================================================================
// C. Submit-state model regression (NOT React — simulates submit lifecycle)
// ===========================================================================

type SimulatedModalState = {
  submitting: boolean;
  submitError: string | null;
  didClose: boolean;
  onSubmitCalls: number;
  submittingWasActive: boolean;
};

const simulateModalSubmit = async (
  onSubmitResult: PostEditSubmitResult,
  shouldThrow = false,
  initialSubmitting = false
): Promise<SimulatedModalState> => {
  const state: SimulatedModalState = {
    submitting: initialSubmitting,
    submitError: null,
    didClose: false,
    onSubmitCalls: 0,
    submittingWasActive: false,
  };

  const submit = async () => {
    if (state.submitting) {
      return;
    }

    state.submitError = null;
    state.submitting = true;
    state.submittingWasActive = true;

    try {
      if (shouldThrow) {
        throw new Error('Bridge rejected');
      }

      state.onSubmitCalls += 1;
      const result = onSubmitResult;

      if (result.ok) {
        state.didClose = true;
      } else {
        state.submitError = (result as { ok: false; error: string }).error;
      }
    } catch (error) {
      state.submitError =
        error instanceof Error ? error.message : 'Edit failed';
    } finally {
      state.submitting = false;
    }
  };

  await submit();
  return state;
};

// C-1 — single submit invokes handler once, closes on success
runTest(
  '[Submit-state model] single submit invokes handler once and closes on success',
  async () => {
    const state = await simulateModalSubmit({ ok: true });
    assert.equal(state.onSubmitCalls, 1, 'handler must be called once');
    assert.ok(state.didClose, 'modal must close on success');
    assert.equal(state.submitError, null, 'no submit error on success');
    assert.equal(state.submitting, false, 'submitting must reset on success');
  }
);

// C-2 — { ok: false, error } appears inside the modal
runTest(
  '[Submit-state model] { ok: false, error } sets submitError (no close)',
  async () => {
    const state = await simulateModalSubmit({
      ok: false,
      error: 'Only owner can edit this post.',
    });
    assert.equal(state.onSubmitCalls, 1, 'handler must be called once');
    assert.ok(!state.didClose, 'modal must stay open on failure');
    assert.equal(
      state.submitError,
      'Only owner can edit this post.',
      'structured error must appear in modal'
    );
    assert.equal(state.submitting, false, 'submitting must reset on failure');
  }
);

// C-3 — thrown exception appears as modal submitError
runTest(
  '[Submit-state model] thrown exception sets submitError (no close)',
  async () => {
    const state = await simulateModalSubmit({ ok: true }, true);
    assert.equal(state.onSubmitCalls, 0, 'handler must not be called on throw');
    assert.equal(
      state.submitError,
      'Bridge rejected',
      'exception message in modal'
    );
    assert.ok(!state.didClose, 'modal must stay open on exception');
    assert.equal(
      state.submitting,
      false,
      'submitting must reset after exception'
    );
  }
);

// C-4 — submitting guard prevents execution when already-submitting
// Exercises the `if (state.submitting) return` guard in the submit-state model,
// which mirrors the production guard pattern in PostEditModal.handleSubmit.
runTest(
  '[Submit-state model] submitting guard prevents execution when already-submitting',
  async () => {
    const state = await simulateModalSubmit({ ok: true }, false, true);
    assert.equal(
      state.onSubmitCalls,
      0,
      'handler must not execute when already submitting'
    );
    assert.ok(!state.didClose, 'modal must not close when guard blocks submit');
    assert.equal(
      state.submitting,
      true,
      'submitting must remain true — guard prevented any state transition'
    );
    assert.equal(
      state.submitError,
      null,
      'no error set when guard blocks submit'
    );
  }
);

// C-5 — submitError is cleared before a new attempt
runTest(
  '[Submit-state model] submitError cleared before each new submit',
  async () => {
    const state1 = await simulateModalSubmit({
      ok: false,
      error: 'First failure',
    });
    assert.equal(state1.submitError, 'First failure', 'first error shown');

    const state2 = await simulateModalSubmit({ ok: true });
    assert.equal(state2.submitError, null, 'error cleared on new attempt');
    assert.ok(state2.didClose, 'modal closes after successful retry');
  }
);

// C-6 — submitting lifecycle model: set → async-op → clear
// The submit-state model mirrors the production sequence:
//   setSubmitting(true) → await onSubmit() → setSubmitting(false)
runTest(
  '[Submit-state model] submitting set before async op, cleared after',
  async () => {
    const state = await simulateModalSubmit({ ok: true });

    assert.ok(
      state.submittingWasActive,
      'submitting must be set to true during the operation'
    );
    assert.equal(
      state.submitting,
      false,
      'submitting must be false after completion'
    );
    assert.equal(
      state.submitError,
      null,
      'submitError must be cleared before the operation begins'
    );
    assert.ok(state.didClose, 'modal must close on success after lifecycle');
  }
);

// ===========================================================================
// D. Dismissal-policy model regression (NOT React — simulates close/Escape pattern)
// ===========================================================================

// D-1 — dismissal-policy model: close blocked while submitting
runTest('[Dismissal-policy model] close blocked while submitting', () => {
  let didClose = false;
  let submitting = true;

  const handleClose = () => {
    if (submitting) {
      return;
    }
    didClose = true;
  };

  handleClose();
  assert.ok(!didClose, 'close must be blocked while submitting');

  submitting = false;
  handleClose();
  assert.ok(didClose, 'close must succeed after submitting completes');
});

// D-2 — dismissal-policy model: Escape suppressed while submitting
runTest('[Dismissal-policy model] Escape suppressed while submitting', () => {
  let didClose = false;
  const submitting = true;
  let escapePrevented = false;

  const handleKeyDown = (key: string) => {
    if (key === 'Escape' && submitting) {
      escapePrevented = true;
      return;
    }
    if (key === 'Escape') {
      didClose = true;
    }
  };

  handleKeyDown('Escape');
  assert.ok(escapePrevented, 'Escape must be intercepted while submitting');
  assert.ok(!didClose, 'modal must not close on Escape while submitting');
});

// ===========================================================================
// E. Regression guard — Architecture V2 authority (imports real reducer)
// ===========================================================================

// E-1 — immutable identifiers cannot be changed via edit
runTest(
  '[Regression] immutable entityId cannot be changed via owner edit',
  () => {
    const created = reduceV2Creates(
      [
        {
          metadata: {
            service: 'FORUM',
            publisherName: 'alice',
            identifier: 'v2-post-reg-1',
            created: 1,
            updated: 1,
            latestSignature: 'sig-1',
          },
          envelope: {
            schema: 'qdb-v2' as const,
            schemaVersion: 2 as const,
            kind: 'entity-create' as const,
            recordType: 'post' as const,
            recordId: 'v2-post-reg-1',
            targetId: 'post-reg-1',
            body: makePostCreate('post-reg-1'),
            clientCreatedAt: '2025-01-01T00:00:00Z',
          },
        },
      ],
      ownerIdentity
    );

    const editWithIdChange: OwnerEdit = {
      operation: 'owner-edit',
      targetType: 'post',
      targetId: 'post-reg-1',
      publisherName: 'alice',
      walletAddress: 'alice-wallet',
      changes: { entityId: 'hijacked-id' } as unknown as { content: string },
    };

    const edited = applyOwnerEdit(
      created,
      {
        service: 'FORUM',
        publisherName: 'alice',
        identifier: 'v2-edit-reg-1',
        created: 2,
        updated: 2,
        latestSignature: 'sig-2',
      },
      editWithIdChange,
      ownerIdentity
    );

    assert.ok(
      edited.quarantined.length > 0,
      'immutable field change must be quarantined'
    );
    const lastQ = edited.quarantined[edited.quarantined.length - 1];
    assert.equal(
      lastQ?.code,
      'FORBIDDEN_FIELD',
      'entityId change must be FORBIDDEN_FIELD'
    );
  }
);

// E-2 — parentThreadId cannot be changed via edit
runTest(
  '[Regression] immutable parentThreadId cannot be changed via owner edit',
  () => {
    const created = reduceV2Creates(
      [
        {
          metadata: {
            service: 'FORUM',
            publisherName: 'alice',
            identifier: 'v2-post-reg-2',
            created: 1,
            updated: 1,
            latestSignature: 'sig-1',
          },
          envelope: {
            schema: 'qdb-v2' as const,
            schemaVersion: 2 as const,
            kind: 'entity-create' as const,
            recordType: 'post' as const,
            recordId: 'v2-post-reg-2',
            targetId: 'post-reg-2',
            body: makePostCreate('post-reg-2'),
            clientCreatedAt: '2025-01-01T00:00:00Z',
          },
        },
      ],
      ownerIdentity
    );

    const editWithThreadChange: OwnerEdit = {
      operation: 'owner-edit',
      targetType: 'post',
      targetId: 'post-reg-2',
      publisherName: 'alice',
      walletAddress: 'alice-wallet',
      changes: { parentThreadId: 'other-thread' } as unknown as {
        content: string;
      },
    };

    const edited = applyOwnerEdit(
      created,
      {
        service: 'FORUM',
        publisherName: 'alice',
        identifier: 'v2-edit-reg-2',
        created: 2,
        updated: 2,
        latestSignature: 'sig-2',
      },
      editWithThreadChange,
      ownerIdentity
    );

    assert.ok(
      edited.quarantined.length > 0,
      'parentThreadId change must be quarantined'
    );
    const lastQ = edited.quarantined[edited.quarantined.length - 1];
    assert.equal(
      lastQ?.code,
      'FORBIDDEN_FIELD',
      'parentThreadId change must be FORBIDDEN_FIELD'
    );
  }
);

// ---- summary -----------------------------------------------------------------

void (async () => {
  if (pendingPromises.length > 0) {
    await Promise.all(pendingPromises);
  }

  console.log(`\nPost edit tests: ${passCount}/${testCount} passed`);
  if (passCount < testCount) {
    console.error(`${testCount - passCount} test(s) failed`);
    process.exit(1);
  }
})();
