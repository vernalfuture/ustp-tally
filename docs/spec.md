# ustp-tally specification

This is how ustp-tally counts, written so that anyone can check the code against it or write a
second implementation that produces the same bytes. It follows the USTP Hub design (voting
methods, results, and auditability). Where the design leaves a choice open, this document makes
it, and [ADR 0001](adr/0001-counting-choices.md) gives the reasons.

## Inputs

The tally is a pure function: an election definition, a list of ballots, and a seed in; every
contest's result out. It reads no clock, no randomness, no files, and no network. Every count is
an integer and every share an exact fraction; nothing uses floating point.

### Election definition

| Field      | Meaning                                                                        |
| ---------- | ------------------------------------------------------------------------------ |
| `id`       | The election's ID                                                              |
| `rollSize` | Eligible voters. Required when a contest uses majority of the roll or a quorum |
| `contests` | One or more contests, each with a unique `id` and a `method`                   |

| Method           | Fields                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `proposal`       | `passRule`: `simple-majority`, `two-thirds`, or `majority-of-roll`. `quorum`: optional share of the roll |
| `choose-n`       | `candidates`, `seats` (1 to candidates), `maxSelections` (N, 1 to candidates), optional `supportFloor`   |
| `instant-runoff` | `candidates`, `maxRanks` (1 to candidates). One seat                                                     |

A share is `{ "numerator": n, "denominator": d }` with integers 0 ≤ n ≤ d and d ≥ 1. A support
floor is `{ "share": ..., "comparison": "at-least" | "more-than" }`.

Election, contest, and candidate IDs are 1 to 128 characters from `A-Z a-z 0-9 . _ : -`, starting
with a letter or digit, so USTP IDs (UUIDv7) and readable slugs fit, and `__proto__`, spaces,
control characters, and bidirectional marks don't. A contest has at most 1000 candidates.

### Ballots

A ballot is one voter's selections across every contest, with no ID and no timestamp:

```json
{ "contests": { "measure-12": "yes", "board": ["lin", "patel"], "chair": ["rivera", "okafor"] } }
```

- Proposal: `"yes"`, `"no"`, or `"abstain"`.
- Choose up to N: one to N distinct candidates, in any order.
- Instant-runoff: one to `maxRanks` distinct candidates, first choice first. A list can't hold a
  tie or a skipped rank.
- A contest the voter skipped is absent from `contests`. An empty list is refused.
- Unknown contests, unknown candidates, unknown fields, and more ballots than `rollSize` are
  refused with a `TallyInputError` naming the path.

### Seed

32 random bytes as 64 lowercase hex digits. Its commitment is the SHA-256 of those bytes, in
lowercase hex. The commitment is published at Scheduled; the seed is revealed at tally time.

## Proposal

Counts Yes, No, Abstain, and ballots with no selection. `ballots` is every ballot cast in the
election.

| Rule                 | Passes when                                |
| -------------------- | ------------------------------------------ |
| Simple majority      | Yes > No. A tie fails                      |
| Two-thirds           | 3 × Yes ≥ 2 × (Yes + No), and Yes + No > 0 |
| Majority of the roll | 2 × Yes > roll size                        |

Abstentions count toward neither side. With a quorum of n/d, the quorum is met when
ballots × d ≥ n × roll size; abstentions and ballots that skipped the contest both count toward
it. The outcome is `passed` when the rule and the quorum are both met.

## Choose up to N

1. Each candidate's votes are the ballots that selected it. `ballots` is every ballot cast,
   including ballots that skipped this contest.
2. With a support floor of n/d, a candidate meets it when votes × d ≥ n × ballots (`at-least`)
   or votes × d > n × ballots (`more-than`). Candidates below the floor can't be elected.
3. Candidates with at least one vote that meet the floor are ranked by votes, and the top
   `seats` are elected. A seat no such candidate can fill stays empty: no draw hands a seat to a
   candidate no ballot chose.
4. If candidates tied at the cutoff are more than the seats left, the seeded draw with purpose
   `seat` orders them, and the seats go to the most favored. The result records the tie and the
   draw order.
5. `tallies` lists every candidate, most votes first. Equal counts keep contest order, except a
   tied block at the cutoff, which is listed in draw order.

N = 1 is plurality, N = seats is block voting, and N = candidates is approval voting.

## Instant-runoff

1. Ballots that skipped the contest are reported as `noSelection` and take no further part.
2. Each round, every ballot that ranked someone counts for its highest-ranked continuing
   candidate. A ballot with no continuing candidate is exhausted. `continuing` is the number of
   ballots counted in the round, and `exhausted` is the running total of exhausted ballots.
3. A candidate with more than half of the continuing ballots (2 × votes > continuing) wins.
4. Otherwise one candidate with the fewest votes is eliminated, and the next round runs.
5. If several candidates tie for fewest, compare their votes in the previous round and keep
   only those with the fewest there; repeat with each earlier round, most recent first, until one
   remains. If round 1 is reached and several still tie, the seeded draw with purpose `eliminate`
   and this round's number orders them, and the least favored is eliminated.
6. If no ballot ranks anyone, there is no winner.

Each round reports every continuing candidate's votes and its transfer (the change from the
previous round; 0 in round 1), the exhausted total and its change, the eliminated candidate,
and any tie-break with the rounds it compared and the draw order.

## Seeded draw

To order tied candidates, compute for each candidate

```
key = HMAC-SHA-256(seed bytes, UTF-8 of RFC 8785 JSON of { contest, purpose, round?, candidate })
```

where `purpose` is `"seat"` (no `round`) or `"eliminate"` (with the round number). Sort the
tied candidates by key, lowest first: that is the draw order, from most to least favored. The
draw reads nothing from the ballots.

Example: `{"candidate":"b","contest":"chair","purpose":"eliminate","round":1}`.

## Election record

The tally part of a certified record, format `ustp-election-record/1`:

| Field             | Contents                                                       |
| ----------------- | -------------------------------------------------------------- |
| `format`          | `"ustp-election-record/1"`                                     |
| `election`        | The election definition above                                  |
| `seed`            | `{ "commitment", "revealed" }`                                 |
| `castVoteRecords` | Every ballot, in canonical form                                |
| `tally`           | `{ "engine": { "name", "version", "integrity"? }, "results" }` |

Cast vote records are in canonical form: each Choose up to N selection lists its candidates in
contest order, so the order a voter clicked in (or the randomized order they saw) is never
published, and the ballots are sorted by their RFC 8785 text, comparing UTF-16 code units. The
record hash is the SHA-256 of the record's RFC 8785 bytes. `engine.integrity`, when present, is
the npm tarball's integrity string for that version, which anyone can compare with
`npm view ustp-tally@<version> dist.integrity`. `engine.name` must be an npm package name,
`engine.version` a semantic version, and `engine.integrity` `sha512-` and 88 base64 characters.

A signed record wraps it:

```json
{ "record": { ... }, "signature": { "algorithm": "ecdsa-p256-sha256", "value": "<base64>" } }
```

The signature is ECDSA P-256 with SHA-256 over the record's RFC 8785 bytes, DER-encoded, as
Cloud KMS, Vault Transit, and AWS KMS return it. The verifying key is given separately, never
taken from the record. The file holding a signed record is exactly the RFC 8785 text of this
envelope, optionally followed by one newline, so the bytes anyone reads are the bytes that were
checked.

## Verifier

`ustp-tally verify <signed-record.json> --public-key <key.pem> [--seed-commitment <hex>]` checks,
in order:

1. That the file is exactly RFC 8785 text. Duplicate keys, extra whitespace, and numbers written
   in a non-canonical way are refused.
2. The signature, with the given ECDSA P-256 public key (SPKI PEM).
3. The record's structure. It prints the record hash and any build hash the record names.
4. The seed: the revealed seed must hash to the record's commitment and, with
   `--seed-commitment`, the record's commitment must be the one published before polls opened.
   Without that option the check proves only that the record agrees with itself, and says so.
5. That the cast vote records are in canonical form and order.
6. That the engine named in the record is this one, name and version.
7. The re-tally: the count is re-run and compared with `tally.results`, field by field.

It exits 0 when every check passes, 1 when any fails, and 2 for unreadable input. Merkle roots,
block chains, anchors (which will carry the published seed commitment), and the count invariant
(ballots = participation records) are runbook step P2.A2.

## Versions

A record names the engine version that counted it, and the verifier refuses to vouch for a
record counted by another version. Any change to what the tally outputs for some input is a new
version.
