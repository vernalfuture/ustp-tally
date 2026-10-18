# Platform Vote 9 (2025)

The U.S. Transhumanist Party's ninth Platform vote and a vote on proposals on investigations and
emergency declarations, held February 17 to March 10, 2025. Results published March 12, 2025.

## Sources

Retrieved October 17, 2026.

| Source                  | URL                                                                                         | SHA-256                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Results (PDF)           | https://transhumanist-party.org/wp-content/uploads/2025/03/USTP_Platform_Vote_9_Results.pdf | `ab003f5f8a4115ee973870f0a8a9fc350c8294e18c6b7eb14daa11e0ca1082c1` |
| Results post            | https://transhumanist-party.org/2025/03/13/results-of-platform-vote-9/                      |                                                                    |
| Official ballot options | https://transhumanist-party.org/2025/02/18/ballot-options-platform-vote-9/                  |                                                                    |

## How the questions map to contests

The party published counts for every question but no ballots. 68 ballots were cast: every
Yes/No/Abstain question sums to 68, and Question II's 33 votes are printed as 48.5%, which is 33/68.

| Questions                     | Ballot form                                                                                              | Contest here                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| I, III, VI, VII, VIII, X, XII | Yes, No, or Abstain                                                                                      | Proposal, simple majority                                                                 |
| XI, XIII, XIV, XV, XVII, XIX  | Current version, the amendment, or Abstain                                                               | Proposal, simple majority, with Yes for the amendment and No for the current text         |
| II, V                         | "Select all the options you support... Any option receiving the majority of votes cast will be included" | Choose up to N with N = seats = options, and a floor of more than 1/2 of all ballots cast |
| XVI, XVIII                    | Rank the options; Abstain means skip the question                                                        | Instant-runoff, decided in round 1                                                        |
| IV, IX, XX                    | Rank the options                                                                                         | Pending, see below                                                                        |

Question II's provisions applied only if Question I passed, which it did. That condition sits
outside the count and isn't modeled.

## What the published results confirm

- Abstentions count toward neither side. Question XV had 13 for the current text, 27 for the
  amendment, and 28 abstentions, and the amendment was adopted. Question XIX's amendment had 34
  of 68 (50.0%) and was adopted.
- Shares of Yes, No, and Abstain are of everyone who answered, abstentions included.
- The select-all floor counts every ballot cast, including ballots that left the question blank:
  33 votes (48.5%) were not included, 36 (52.9%) were.
- Ranked questions count only ballots that ranked someone: Question XVI's round 1 had 58 votes
  cast of 68.

## How the test uses the counts

`ballotsFromPublishedCounts` in `src/test-support/published.ts` expands each question's counts
into that many anonymous selections. A Proposal's result reads only its Yes, No, and Abstain
totals, Choose up to N only its per-option totals and the ballot count, and an instant-runoff
decided in round 1 only its first preferences. So the expansion can't change any result here.
Which selections shared a ballot isn't known and isn't used.

## Pending: Questions IV, IX, and XX

These went past round 1, and their rounds depend on each ballot's full ranking. The party
published only round totals, which are kept in `published.json` under `pending` until the
anonymized rankings are available. Question IX also tied in round 1: E9-F-1 and E9-F-NO had 6
votes each, and the party eliminated E9-F-NO for having fewer second-choice votes, the rule of
the Instant-Runoff Voting Tool it used (https://petertheone.github.io/IRV/). This library breaks
that tie as the design says: earlier rounds, then the seeded draw. With no earlier round, that
goes to the draw, so Question IX can't match the published rounds under the design's rule even
with the ballots.
