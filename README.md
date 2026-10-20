# ustp-tally

The vote-counting library and election-record verifier for USTP Hub, the U.S. Transhumanist
Party's member and voting platform. It counts three kinds of contest:

- **Proposal**: Yes, No, Abstain, with a simple-majority, two-thirds, or majority-of-the-roll
  rule and an optional quorum. Abstentions count toward the quorum, never toward the ratio.
- **Choose up to N**: plurality, block, or approval voting, with an optional support floor.
- **Instant-runoff**: one seat, majority of continuing ballots, exhausted ballots reported every
  round.

Ties never go to a person. Elimination ties compare earlier rounds, most recent first, and
anything still tied is settled by a draw from a seed committed before polls opened.

The count is a pure function with no I/O, clock, or randomness, so the voting worker, this
verifier, and the browser's Verify page get the same answer from the same record. The rules are
written out in [docs/spec.md](docs/spec.md).

## Verify an election record

```bash
npx ustp-tally@0.1.0 verify tally-record.json --public-key ustp-records.pem --seed-commitment <hex>
```

Use the version the record names, the party's published record-signing key, and the seed
commitment the election page showed before polls opened. The verifier checks that the file is
exact RFC 8785 text, the signature, the seed against that commitment, the cast vote records'
canonical form, and the engine version, then re-runs the count and compares it with the
published result:

```
ustp-tally 0.1.0: verifying tally-record.json
pass  signature    valid: ECDSA P-256 with SHA-256 over the RFC 8785 document, key sha256:…
info  tally hash   sha256:…
pass  seed         the revealed seed matches the published commitment …
pass  ballot order 312 cast vote records in canonical order
pass  engine       counted with ustp-tally 0.1.0, the version running here
pass  re-tally     1 of 1 contests match the published result
Verified.
```

Nothing verifies on the record's word alone. Without `--seed-commitment`, the seed is unchecked
and the verifier exits 3, saying what it couldn't check. The same goes for a signed results file
(`ustp-election-results/1`), which an election publishes when its cast vote records are
auditor-only: the verifier checks its seed, engine, and consistency, but only an auditor holding
the tally record can re-run the count.

| Exit | Meaning                                                 |
| ---- | ------------------------------------------------------- |
| 0    | Verified                                                |
| 1    | A check failed                                          |
| 2    | Unreadable input or a bad option                        |
| 3    | Nothing failed, but at least one check couldn't be made |

Checks of the signed indexes, Merkle roots, block chains, and anchors come in a later release.

## Use the library

```bash
pnpm add --save-exact ustp-tally@0.1.0
```

```ts
import { createRecord, tallyElection } from 'ustp-tally';

const results = tallyElection(election, ballots, seed);
const record = createRecord({ election, ballots, seed, seedCommitment });
```

Pin an exact version: a record names the version that counted it.

## Tested against past USTP votes

`pnpm test` re-counts past votes from the party's published results and checks every count,
share, round, and outcome ([fixtures/](fixtures/README.md)):

| Vote                                 | Contests                            | Result                                  |
| ------------------------------------ | ----------------------------------- | --------------------------------------- |
| Platform Vote 9 (2025), 68 ballots   | 17 of 20 questions                  | Every count, share, and outcome matches |
| 2019 Electronic Primary, 312 ballots | Instant-runoff, 9 options, 7 rounds | Every round matches                     |
| 2023 Electronic Primary, 129 ballots | Instant-runoff, 3 options           | Round 1 matches                         |

Platform Vote 9's Questions IV, IX, and XX ran past round 1, and the party published only their
round totals, not the rankings a re-count needs. They stay pending. Question IX also broke a
round-1 tie by second-choice counts, a rule this library doesn't have (the design compares
earlier rounds, then draws), so it can't match even with its rankings.

## Develop

Node 24.11 or later (26 in CI) and pnpm 12.

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## License

MIT
