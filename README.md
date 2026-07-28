# DreamNet Claim Factory

DreamNet Claim Factory is a public reference implementation for turning
evidence into durable claims without allowing a producing system to certify its
own work.

The central design decision is organizational:

> A Claim Factory has credentialed workers. A separate Verification Factory
> audits its output. No factory self-certifies.

## Why This Exists

Receipts and claims are different artifacts:

- a receipt records what happened,
- a claim records what is believed to be true,
- a verification report records an independent attempt to reproduce or falsify
  that claim,
- a promotion decision records why policy allowed or refused promotion.

This package keeps those boundaries explicit and content-addressed.

## Operating Model

```text
Agent University
  -> ToolGym practical exams
  -> Security Gauntlet
  -> scoped worker credential
  -> Producing Claim Factory
  -> independent Verification Factory
  -> deterministic promotion gate
  -> Claim Registry / Memory Grid
  -> domain Claim City
```

Factories are workplaces, not prompts. Their workers occupy bounded roles such
as evidence binder, contradiction hunter, source-span verifier, confidence
calibrator, independent reproducer, and factory auditor.

A Claim City is a domain boundary that coordinates several factories. It does
not become a second truth authority. Cross-city federation transports portable
claim envelopes; each destination domain applies its own policy.

## Current Capabilities

- University credential and worker-roster validation
- deterministic, content-addressed claim production
- source-span and provenance receipt requirements
- producer/verifier lineage separation
- explicit rejection of self-verification
- deterministic promotion, dispute, and human-approval decisions
- Claim City validation and verifier routing
- zero runtime dependencies

This repository deliberately does not contain an LLM extractor. Model-assisted
claim drafting belongs behind these contracts and may never assign final status
to its own output.

## Quick Start

```bash
npm ci
npm test
```

The tests demonstrate successful independent promotion, challenged claims,
human-gated high-risk claims, rejected credentials, worker overlap, and
self-certification failure.

## Documents

- [Claim Economy Constitution](docs/CLAIM_ECONOMY_CONSTITUTION.md)
- [University Workforce Protocol](docs/UNIVERSITY_WORKFORCE_PROTOCOL.md)
- [Independent Factory Protocol](docs/INDEPENDENT_FACTORY_PROTOCOL.md)
- [Claim City Model](docs/CLAIM_CITY_MODEL.md)
- [Security](SECURITY.md)

## Scope

This is a reference contract and deterministic policy engine. It does not make
claims true, authorize regulated decisions, hold credentials, sign receipts, or
replace qualified human review. Production deployments must supply trusted
identity, signatures, durable storage, privacy controls, and domain-specific
evaluation.

## License

Apache-2.0

