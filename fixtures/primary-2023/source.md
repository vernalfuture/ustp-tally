# 2023 Electronic Primary

The U.S. Transhumanist Party's primary for its endorsement for President, held May 14 to 22, 2023. 129 valid ballots ranked up to three options, and Tom Ross won in round 1.

## Sources

Retrieved October 17, 2026.

| Source                                          | URL                                                                                                                  | SHA-256                                                            |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Results (PDF)                                   | https://transhumanist-party.org/wp-content/uploads/2023/05/USTP_2023_Presidential_Primary_Vote_Results.pdf           | `4743a90fca05ad34757c77c216f7bf2b9aa5b261ce2d81fb868db35948e6c47b` |
| Detailed spreadsheet, sheet "Validated Ballots" | https://transhumanist-party.org/wp-content/uploads/2023/05/USTP_Detailed_2023_Presidential_Primary_Vote_Results.xlsx | `18059dcd21c3fa8215709698d99e816d54a2a4cc5ca2f483a05037ea86a91d67` |
| Results post                                    | https://transhumanist-party.org/2023/05/23/ustp-2023-electronic-primary-results/                                     |                                                                    |

## How ballots.json was made

```bash
node scripts/fixtures/primary-2023.mjs USTP_Detailed_2023_Presidential_Primary_Vote_Results.xlsx
```

The converter checks the file's hash and column headings, reads the 129 rows marked "Manually
Validated", and keeps only the three rank columns. It drops each row's vote timestamp, assigned
voter ID, and validation time, and writes the ballots in canonical sorted order. The output's
SHA-256 is `0320a02f4b6ab9898cd3d5a7d557a8520dc202aae959e790f1a7b8fac5ec3c4b`.

The party discarded four of 133 ballots before counting: one blank, one superseded by the same
member's later vote, and two from addresses not on the membership list. The sheet's only other
rows are its totals, so the 129 rows marked validated are exactly the ballots counted.

## One ballot with a skipped rank

One validated ballot ranks Twedt 1st and Ross 3rd with no 2nd choice. The party counted it.
This library's ballot format lists choices in order and can't hold a gap (the design has the
server refuse one), so the converter moves Ross up to 2nd and refuses any other irregularity.
Its first choice, the only one round 1 reads, is unchanged. The published summary of rankings
counts that Ross as a 3rd choice, so the test expects one more 2nd choice and one fewer 3rd
choice for Ross than the summary prints, and says why.

## What the test checks

- The ballots reproduce the published summary of rankings, with the adjustment above.
- Round 1: every count, every share to two decimals, and Ross's majority.
