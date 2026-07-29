# Lead Intelligence Verification Profile

This profile makes lead acceptance an outside Claim Factory decision. The
discovery or enrichment factory cannot clear its own records.

## Boundary

```text
Discovery / enrichment factory
  -> opaque lead reference + producer receipt
  -> outside Lead Verification Factory
  -> independent identity, contact, dedupe, freshness, suppression,
     and campaign-fit observations
  -> content-addressed verification decision
  -> human review
  -> client delivery or outreach system
```

The verifier receives an opaque `leadRef`, evidence digests, provenance
receipts, and source references. Raw names, phone numbers, email addresses, and
street addresses are rejected at this public contract boundary.

The private verifier runtime may resolve restricted evidence through its own
credentialed adapters. It must not copy that material into a public claim,
receipt, log, or Git repository.

## Required Controls

- `identity`: the business or household resolution is independently supported.
- `contact`: contact ownership is independently supported by the configured
  minimum number of evidence sources.
- `dedupe`: the contact and entity are not unresolved duplicates elsewhere.
- `freshness`: evidence is inside the policy time window.
- `campaign_fit`: evidence supports inclusion in this campaign without
  fabricating wealth, suitability, or allocation claims.
- `suppression`: required before any outreach-eligibility decision.

Any failed control quarantines the lead. Missing or weak evidence is
inconclusive. Stale evidence expires the decision. Passing every control makes
the lead eligible for human review only; it never authorizes automatic
outreach.

## Independence Requirements

- producer and verifier use different factory identities,
- verifier workers hold current University credentials,
- raw PII remains outside the portable verification contract,
- the verifier emits a new decision digest instead of rewriting producer data,
- the human approval and channel-compliance gates remain downstream,
- high-risk deployments should use separate runtimes, credentials, retrieval
  adapters, caches, and signing keys.

## GitHub Storage

Git may store the profile, schemas, policy versions, opaque references,
digests, sanitized receipts, and aggregate status counts. Direct contact and
household data must remain in a deletable private system of record or encrypted
object referenced by digest.
