# Ceres: hand-over for the technology team

Ceres is a leadership survey for J.P. Morgan's International Private Bank about serving clients with $5-20mm of liquid
net worth. This repository holds what is needed to build it inside J.P. Morgan systems: the questionnaire, a working
front-end reference, and the database design.

Version: third draft, 16 October 2026 (after the review notes of 15 October).

## Where to start

| You want | Open |
|---|---|
| The questions, as reviewed | `questionnaire/v3/Ceres questionnaire - third draft.docx` |
| To click through the survey | `preview/index.html` in Chrome or Edge. It works offline from the folder, and nothing is saved anywhere |
| How each screen behaves and what it saves | `preview/CONTRACT.md` |
| How to store the answers | `data-spec/Ceres database hand-over.docx` (the same content as `data/data-dictionary.md`) |

## What is here

| Folder | What it holds |
|---|---|
| `questionnaire/v3/` | `script.js`, the single source of truth for every screen, question, option and answer shape: 77 screens (42 questions, 21 follow-ups, 10 chapter breaks, the welcome, the opening statement, the pause card and the ending). Also the Word questionnaire built from it |
| `preview/` | The review preview: static HTML and JavaScript, no build step, no libraries. One page per screen type, opened as `t-<template>.html?id=<step>`. Its `script.js` is a byte-for-byte copy of `questionnaire/v3/script.js` |
| `data/` | The database package: `sql/` (schema, the questionnaire as seed data, two sample respondents, 19 analysis queries, self-checks), `tools/` (the answer mapping in plain JavaScript, and the checks) and `data-dictionary.md` |
| `data-spec/` | The database hand-over as a Word document, and the wording of the SID and name screen |

## Notes for the build

- Respondents type their SID and full name on a new first screen. Its wording is in `data-spec/identity-screen.md`.
  If the survey sits behind J.P. Morgan single sign-on, take both from the session instead.
- The preview is a review tool. Next always works and nothing is sent anywhere; answers stay in the browser. The real
  survey needs each screen's completion rule (shown in the preview as "In the survey: ...") and the storage in `data/`.
- Conditional follow-ups always show in the preview, with a grey note saying when they would appear. The rules are
  `shows()` in `data/tools/flatten.mjs`.
- `preview/t-blank.html` and `preview/t-keep.html` are no longer used; they stay only so old links still land.
- Two preview behaviours should not be copied into the real build. They are listed under "Known preview issues" in the
  database hand-over.
- The decisions left to the build team are at the end of the database hand-over.

## Checking the database package

It needs PostgreSQL 16 and node 18 or later:

```
cd data
PGBIN=/path/to/postgresql-16/bin tools/check-on-postgres.sh
```

The script builds a throwaway database, loads everything, runs every check and deletes the database. At hand-over:
135 SQL checks and 1,484 JavaScript checks pass. PostgreSQL is the reference dialect. The SQL Server and Oracle notes in
the hand-over come from the vendors' documentation and have not been run on those engines.

## Contact

Haresh
