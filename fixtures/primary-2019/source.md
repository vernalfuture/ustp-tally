# 2019 Electronic Primary

The U.S. Transhumanist Party's primary for its endorsement for President, held September 21 to
30, 2019. 312 ballots ranked nine options, and Johannon Ben Zion won in round 7.

## Sources

Retrieved October 17, 2026.

| Source                                                        | URL                                                                                                                                                | SHA-256                                                            |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Results (PDF)                                                 | https://transhumanist-party.org/wp-content/uploads/2019/10/USTP_2019_Presidential_Primary_Vote_Results.pdf                                         | `5dcc7c8f4c7a428dbc5cef3aa2f3147c0ed193eda780af0280b6730f50e888ab` |
| Ballots as entered into the Instant-Runoff Voting Tool (text) | https://transhumanist-party.org/wp-content/uploads/2019/10/USTP_Presidential_Primary_Election_Input_Parameters_into_Instant-Runoff_Voting_Tool.txt | `ed2bad0a7f152db4a5293dc969d710cac64bdc1f44d35dfc30a6f0d278860184` |
| Detailed spreadsheet (not used)                               | https://transhumanist-party.org/wp-content/uploads/2019/10/USTP_Detailed_2019_Presidential_Primary_Vote_Results.xlsx                               | `8e147a5e7b55c6234e56aa24a9c514ddd3532cfcd000f25ead634e0e432332ce` |
| Results post                                                  | https://transhumanist-party.org/2019/10/02/ustp-2019-electronic-primary-results/                                                                   |                                                                    |

## How ballots.json was made

```bash
node scripts/fixtures/primary-2019.mjs USTP_Presidential_Primary_Election_Input_Parameters_into_Instant-Runoff_Voting_Tool.txt
```

The text file lists the nine options, then one line per ballot giving each option's rank in list
order. The converter checks the file's hash and the option names, turns each line into a
ranking, refuses any line that isn't a full ranking 1 to 9, and writes the ballots in canonical
sorted order. The output's SHA-256 is
`2cbf324dee2aa922542a3f9cbb48bdc53a0bcc0a7cdfbe222c1b532074aa0e53`.

The text file is the source, not the spreadsheet, because it holds only rankings. The spreadsheet
lists each ballot's vote time and assigned voter ID, which a fixture must not carry.

Kimberly Forsythe withdrew while voting was open. The party removed her from the first 170
ballots and moved lower choices up before counting, and the text file already reflects that, so
she isn't a candidate here.

## What the test checks

- The ballots reproduce the published summary of rankings: how many 1st through 9th choices
  each option received.
- All seven rounds: every count, every share of continuing ballots to two decimals, who was
  eliminated, and the winner. No round has a tie.
