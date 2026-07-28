# Independent Factory Protocol

## Rule

The verification factory is organizationally separate from the producing
factory. A quorum inside the producing factory is useful peer review, but it is
not independent verification.

## Minimum Independence

- different factory identity,
- no worker overlap for the run,
- separate receipts,
- immutable claim digest as the input boundary,
- no producer write access to verifier state,
- no verifier write access to the proposed claim,
- distinct model lineage when policy requires it,
- distinct retrieval lineage when policy requires it.

High-risk deployments should also separate runtime, credentials, caches, and
signing keys.

## Verifier Output

A verifier emits one of:

- `supports`: evidence was independently reproduced,
- `challenges`: material counterevidence or a failed premise was found,
- `inconclusive`: the evidence was insufficient to decide.

It does not rewrite the claim. Its report binds to the exact claim digest.

## Promotion

The deterministic promotion gate rejects:

- self-verification,
- overlapping workers,
- policy-version drift,
- mismatched claim digests,
- insufficient reports,
- missing human approval for high-impact domains.

A challenge moves the claim to `disputed`; it is never silently discarded.

