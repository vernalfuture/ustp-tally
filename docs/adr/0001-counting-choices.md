# 0001. Counting choices the design leaves open

- Status: Proposed
- Date: 2026-10-17
- Source: USTP Hub design, voting-methods.md, results.md, and auditability.md; runbook step P1.3

## Context

The design fixes the methods, the pass rules, strict majorities, abstentions outside the
Yes/No ratio, and the tie-break order. Writing the count down exactly surfaced choices it
doesn't make. Past USTP votes settle some of them: Platform Vote 9 (2025) and the 2019 and 2023
primaries are the test fixtures.

## Decision

- **Support floor comparison.** A floor is either `at-least` (the design's goal-slate wording,
  "at least the support floor share") or `more-than`. Platform Vote 9's select-all questions
  said "the majority of votes cast", which is more than half, and use `more-than`.
- **Floor and quorum denominators.** Both count every ballot cast in the election, including
  ballots that skipped the contest. Platform Vote 9 printed 33 votes as 48.5%, which is 33 of
  all 68 ballots.
- **Two-thirds with no Yes or No votes** fails, rather than passing on 0 ≥ 0.
- **Blank ranked ballots** are reported as no selection, not as exhausted, and never count in
  round 1. Platform Vote 9's ranked questions counted only ballots that ranked someone.
- **No rankings at all** gives no winner, rather than a winner chosen by eliminating zeros.
- **Seats need a vote.** In Choose up to N, a candidate with no votes is never elected, so a seat
  no candidate with votes can fill stays empty. "Most votes fill the seats" shouldn't mean a draw
  among candidates no ballot chose.
- **IDs and limits.** Election, contest, and candidate IDs are 1 to 128 of `A-Z a-z 0-9 . _ : -`,
  starting with a letter or digit: USTP IDs and slugs fit, and `__proto__`, control characters,
  and bidirectional marks don't. Ballots are read by own fields only, so a contest named
  `constructor` counts like any other. A contest has at most 1000 candidates.
- **The seeded draw** is HMAC-SHA-256 keyed by the seed over the RFC 8785 JSON of the draw's
  context and the candidate, lowest key most favored (docs/spec.md). HMAC keys each draw to the
  committed seed, and the context makes every round's and contest's draw independent.
- **Signature.** ECDSA P-256 with SHA-256, DER-encoded, over the record's RFC 8785 bytes. It is
  offered by every Signer backend in the design, Vault Transit, Cloud KMS, AWS KMS, and Azure Key
  Vault, with short keys and signatures. Azure returns the raw r and s values, so its adapter
  converts them to DER.
- **Cast vote records.** Choose up to N selections list candidates in contest order, and records
  holding any other order are refused. A selection's order would otherwise publish click order or
  the voter's randomized display order, which a coercer could dictate and look for.
- **Record files.** A signed record file is exactly the RFC 8785 text of its envelope, plus at
  most one newline. JSON.parse keeps the last of two duplicate keys and rounds long numbers, so
  without this a file could verify while showing a reader something else.
- **Seed commitment.** The commitment that matters is the one published at Scheduled, outside
  the record. `createRecord` requires it, and the verifier checks against it with
  `--seed-commitment`. Without it the seed check is unchecked and nothing verifies: the CLI
  exits 3 and says what it couldn't check (USTP Hub ADR 0016, "No anchors, no pass"). Anchors in
  P2.A2 will supply the commitment and replace the option.
- **Tally hash and results file.** Following USTP Hub ADR 0016, the hash of the tally record is
  the tally hash; the election's record hash is the hash of its signed public index. When cast
  vote records are auditor-only, the public tier carries a signed `ustp-election-results/1`
  file made from the tally record. Public data checks its seed, engine, and consistency but
  can't re-run the count, so a results file never verifies on its own.
- **Engine identity.** A record names the package name and version, and optionally the npm
  tarball's integrity string as the build hash. The verifier requires the same name and version,
  and prints the build hash for comparison with the registry.
- **Dependencies.** The only runtime dependency is @noble/hashes (audited, synchronous, and the
  same in Node and browsers), pinned to an exact version. RFC 8785 is implemented here and
  tested against the RFC's examples.

## Consequences

- The legacy tie-break USTP used in 2025 and 2017 (fewest next-preference votes, then random)
  isn't offered. Platform Vote 9's Question IX can't match its published rounds under the
  design's rule even with its ballots, so it stays pending until someone decides whether to add
  that rule for historical fixtures.
- USTP Hub's design documents should record the floor comparison, the denominators, empty
  seats, and the draw. Until they do, this ADR and docs/spec.md are the reference.
- The voting worker must write signed files with canonicalize, pass the published seed
  commitment to createRecord, and sign the results file too when cast vote records are
  auditor-only.
