# Fixtures: past USTP votes

Each folder holds one past U.S. Transhumanist Party vote, taken from the party's own published
results. `src/fixtures.test.ts` re-counts it with this library and checks every published count,
share, round, and outcome.

| Folder                                       | Vote                                 | Ballot data         | What it checks                                                                                                                                                   |
| -------------------------------------------- | ------------------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [platform-vote-9](platform-vote-9/source.md) | Platform Vote 9, 2025, 68 ballots    | Counts only         | 17 of 20 questions: Yes/No/Abstain, amendments against current text, two select-all questions with a majority floor, and two ranked questions decided in round 1 |
| [primary-2019](primary-2019/source.md)       | 2019 Electronic Primary, 312 ballots | Anonymized rankings | A 9-option instant-runoff over 7 rounds                                                                                                                          |
| [primary-2023](primary-2023/source.md)       | 2023 Electronic Primary, 129 ballots | Anonymized rankings | A 3-option instant-runoff with partial rankings, won in round 1                                                                                                  |

Files in each folder:

- `source.md`: where every number came from, with retrieval dates and SHA-256 hashes.
- `election.json`: the contests and their rules, as the ballot stated them.
- `published.json`: the published results, transcribed by hand. Nothing in it comes from this engine.
- `ballots.json` (primaries only): anonymous ballots, written by the converter in `scripts/fixtures`.

## Rules for fixtures

- Never invent a ballot. Where the party published only counts, the test expands each question's
  counts into selections, and only for methods whose result reads nothing but those counts. Any
  count that needs real ballots stays pending, with what is missing named in `published.json`.
- Keep only what the count needs. The published spreadsheets list a vote timestamp and an assigned
  voter ID beside each ballot. Converters drop both and write ballots in canonical sorted order,
  so nothing here links a ballot to a voter or to a time.
- Cite every source and record its SHA-256, so anyone can download it again and re-run the
  converter to get the same bytes.
