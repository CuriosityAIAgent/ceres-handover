# Ceres: data dictionary and storage hand-over (questionnaire v3)

Ceres is a leadership survey for J.P. Morgan's International Private Bank on serving clients with $5-20mm of liquid net
worth. This folder is for the J.P. Morgan developer who builds its storage inside J.P. Morgan systems. It holds a
reference schema (PostgreSQL 16, portable types), the v3 questionnaire as seed data, two sample respondents, ready
analysis queries, and the reference mapping from a saved answer to analysis rows in plain JavaScript.

The source of truth for every step, option and answer shape is `questionnaire/v3/script.js` (77 steps: 42 questions,
21 follow-ups, 10 chapter breaks, plus the welcome, the opening statement, the pause card and the ending). The shapes of
saved answers are the ones the preview's template pages save (`preview/t-*.html`, summarised in `preview/CONTRACT.md`).

## Files

| File | What it is |
|---|---|
| `sql/01-schema.sql` | Tables, keys, checks and indexes, with a comment on every table and column; at the end, an optional trigger that keeps a submitted run from changing |
| `sql/02-questionnaire-v3.sql` | Generated. The questionnaire row, its 77 steps and every option |
| `sql/03-sample-respondent.sql` | Generated. Two submitted runs: R000001 answers all 63 questions and follow-ups; R000002 sees none of the eleven conditional steps (rows with `shown = false`), has nothing to place on 5.2 and leaves 10.4 empty. Their answer, answer_item and answer_event rows |
| `sql/04-analysis-queries.sql` | Ready queries, each with a comment saying which question it answers |
| `sql/05-checks.sql` | Generated. Self-checks for this package: counts against script.js, joins, the screens' rules, what the schema and the triggers refuse, the save rules, a rebuild of answer_item on a submitted run, and the values of the 04 queries for the cases R000002 exercises (PostgreSQL only; not for production) |
| `tools/flatten.mjs` | The reference mapping: `flatten()`, `validate()`, `shows()`, `refs()`. Plain JavaScript, no dependencies |
| `tools/build-sql.mjs` | Writes 02, 03, 05 and the generated sections of this file from script.js |
| `tools/sample-answers.mjs` | The two sample respondents' answers |
| `tools/load-script.mjs` | Loads script.js in node: `source/script.js` in a hand-over copy of this folder if there is one, else `../questionnaire/v3/script.js` |
| `tools/verify.mjs` | Tests `validate()`, `shows()` and `flatten()` on good and bad answers; then, on a loaded database: the seed equals script.js, and for both sample runs each stored answer equals its sample, `shows()` equals `answer.shown`, `validate()` passes, and `flatten()` of each stored value gives the stored rows; and it runs the documented rebuild of answer_item on a submitted run, with `flatten()` |
| `tools/check-on-postgres.sh` | Builds a throwaway PostgreSQL 16 cluster, loads 01-05, runs verify.mjs, deletes the cluster |

Load into an empty database:

```
psql -v ON_ERROR_STOP=1 -d ceres -f sql/01-schema.sql
psql -v ON_ERROR_STOP=1 -d ceres -f sql/02-questionnaire-v3.sql
psql -v ON_ERROR_STOP=1 -d ceres -f sql/03-sample-respondent.sql   # sample data: leave out in production
psql -v ON_ERROR_STOP=1 -d ceres -f sql/04-analysis-queries.sql    # runs every query
psql -v ON_ERROR_STOP=1 -d ceres -f sql/05-checks.sql              # self-checks (they expect the two samples)
```

Rebuild the generated files after a change to script.js, 01 or 04: `node tools/build-sql.mjs` (node 18 or later). It is
deterministic: the same inputs give the same files byte for byte. Check everything end to end:
`tools/check-on-postgres.sh` (set `PGBIN` if PostgreSQL 16 is not at `/opt/homebrew/opt/postgresql@16/bin`).

## How a run is stored

One run per person, ever. Every write to a run happens in a transaction that first locks the run's `submission` row,
so saves, the rows of steps that do not show, and Send never interleave, and nothing changes once a run is submitted.

1. **The identity screen** (new, before the welcome W). The respondent types their SID and full name. The server
   cleans both (next section) and finds the respondent by SID, or creates one. It then finds their run, whatever its
   version: if it is `submitted`, it thanks them and stops; if it is `in_progress`, it resumes it at `last_step_id`
   under the version the run started with; only if they have no run does it create one, under the current version
   (`status = 'in_progress'`). There is never a second run (`ux_submission_respondent`, a unique index on
   `submission (respondent_id)`). The identity screen is not in script.js, so it is not a row of `step`, and nothing it
   collects goes into `answer`. New `respondent_id` and `submission_id` values are random (`gen_random_uuid()` or the
   like), never derived from the SID or the name.
2. **Every save** (an autosave draft while the respondent is on a screen, or the commit when Next leaves it), in one
   transaction:
   1. Lock the run: `SELECT status, version FROM submission WHERE submission_id = :id FOR UPDATE` (SQL Server:
      `SELECT status, version FROM submission WITH (UPDLOCK, ROWLOCK) WHERE submission_id = :id`). If the status is
      `submitted`, refuse the save.
   2. Read the run's other answers, inside the transaction, and call `validate(step, value, { steps, answers })`
      (`steps`: script.js's steps; `answers`: the run's answers by step id). Refuse the save when `ok` is false. While
      the run is in progress, accept an answer that is not yet `complete`. `notes` says what was ignored or not
      checked. Full strictness needs `answers`: without the answer a check depends on (2.2 for 2.3 and 2.6, 5.1 for 5.2,
      a parent for its follow-up), that check is relaxed.
   3. If a note says "not shown", the step does not show: store its row with `shown = false` and `value_json` NULL,
      delete its answer_item rows, and keep nothing that came with it. Otherwise store the value with `shown = true`.
      Every save that stores a value sets `shown = true`, so a step first written as not shown can be answered later
      (`ck_answer_shown` refuses a value on a row still marked not shown):

      ```sql
      INSERT INTO answer (submission_id, version, step_id, value_json, shown, first_saved_at, saved_at, revision)
      VALUES (:submission_id, :version, :step_id, :value_json, true, :now, :now, 1)
      ON CONFLICT (submission_id, step_id) DO UPDATE
        SET value_json = EXCLUDED.value_json, shown = true, revision = answer.revision + 1,
            saved_at = GREATEST(answer.first_saved_at, EXCLUDED.saved_at);
      ```

      (SQL Server and Oracle: the same with `MERGE`.) Take `:now` from the application's clock, and keep the
      `GREATEST(...)` on update, so `saved_at` never falls before `first_saved_at` (`ck_answer_times`); the lock already
      stops two saves of one run from crossing. Oracle and SQL Server 2022 have `GREATEST`; on SQL Server 2016 to 2019
      write `CASE WHEN target.first_saved_at > source.saved_at THEN target.first_saved_at ELSE source.saved_at END`.
   4. Delete the step's answer_item rows and insert `flatten(step, value, { steps, answers })`; append an
      `answer_event` row if you keep that table; update the run's `last_saved_at`, `last_step_id` and `device`.
3. **Steps that do not show** are written on a commit (Next) or at Send, never on a draft. When Next takes the
   respondent past the place of a step and `shows(step, answers, ctx)` is false (a conditional step that did not fire,
   or a wave-1-only step in wave 2), write its row with `shown = false`, `value_json` NULL and no answer_item rows. A
   parent's drafts must not do this: in the middle of a card sort, Undo can leave Critical with three cards for a
   moment, and that must not wipe 2.2a. A step that shows but leaves nothing to store also gets its row when Next
   passes it, with `shown = true` and `value_json` NULL: 5.2 when 5.1's split is $10mm (nothing to place), and 10.4
   left empty.
4. **Send** (Next on 10.5), in one transaction under the same lock (refuse it if the run is already submitted). Walk
   every step that saves an answer, in play order, with the run's answers:
   - if `shows()` is false: set `shown = false` and `value_json` NULL, and delete its answer_item rows. This clears an
     answer left on a step that has since stopped showing, such as 2.2a after a card left Critical;
   - otherwise: require `validate(step, value, { steps, answers }).complete` (if a step is not complete, refuse Send
     and take the respondent to it), set `shown = true`, and rewrite its answer_item rows with
     `flatten(step, value, { steps, answers })`. A step with no row yet gets one, as in 3.

   Then set `status = 'submitted'` and `submitted_at`. From then on the run cannot change: every save refuses it, and
   the optional trigger at the end of 01 (`refuse_write_to_submitted_run`) refuses inserts and updates of its answer,
   answer_item and answer_event rows in the database too (deletes, to erase a run, still work).

## Rebuilding answer_item

`answer_item` can be rebuilt from `answer.value_json` at any time, for instance after a fix to `flatten()`. For each run,
call `flatten(step, value, { steps, answers })` with the run's other answers (5.2's rows depend on 5.1's answer), for
every row with `shown = true`, and skip rows with `shown = false`.

For a submitted run the optional trigger `tg_answer_item_submitted` refuses those inserts, so the rebuild is a
privileged job that switches that one trigger off inside its own transaction:

```sql
BEGIN;
SELECT submission_id FROM submission WHERE submission_id IN (:runs) FOR UPDATE;   -- lock the runs
LOCK TABLE answer_item IN EXCLUSIVE MODE;                                         -- no other writes meanwhile
ALTER TABLE answer_item DISABLE TRIGGER tg_answer_item_submitted;
DELETE FROM answer_item WHERE submission_id IN (:runs);
INSERT INTO answer_item (...) VALUES (...);   -- flatten(step, value, { steps, answers }) for each shown answer
ALTER TABLE answer_item ENABLE TRIGGER tg_answer_item_submitted;
COMMIT;                                       -- on any error: ROLLBACK, which also undoes the DISABLE
```

- It needs the table owner's rights (`ALTER TABLE ... DISABLE TRIGGER`); run it as a maintenance job, not as the
  application's user.
- Only `answer_item`'s trigger is switched off. `tg_answer_submitted`, `tg_answer_event_submitted` and the checks on
  `submission` stay on, so the answers themselves cannot change.
- In PostgreSQL the `DISABLE` is part of the transaction: other sessions never see the trigger off, and a failure rolls
  it back with everything else. 05 rebuilds R000002's submitted run this way, and also checks that a rebuild failing
  part-way leaves the rows and the trigger as they were; `verify.mjs` runs it with `flatten()` itself.
- SQL Server: `DISABLE TRIGGER tg_answer_item_submitted ON answer_item;` and `ENABLE TRIGGER ... ON answer_item;`
  inside `BEGIN TRANSACTION ... COMMIT` (also transactional; needs `ALTER` permission on the table), with
  `WITH (TABLOCKX, HOLDLOCK)` on a first read of `answer_item` in place of `LOCK TABLE`.
- Oracle: `ALTER TRIGGER tg_answer_item_submitted DISABLE;` and `ENABLE;` are DDL, which commits on its own, so they
  cannot sit inside the rebuild's transaction. Either:
  - stop writes, disable the trigger, rebuild, and `COMMIT` only once the whole rebuild has succeeded. On any error,
    `ROLLBACK` first and only then re-enable the trigger (in a `finally` block): an `ENABLE` before the rollback would
    commit a half-done rebuild. Keep writes stopped until the trigger is enabled again; or
  - give the Oracle trigger a bypass that only the rebuild session can turn on (an application context the trigger
    checks), which keeps the rebuild in one transaction.

## Identity: the SID and the name

|  | SID (J.P. Morgan Standard ID) | Full name |
|---|---|---|
| Clean | Remove whitespace at both ends (spaces, tabs, non-breaking spaces from a paste); upper-case without a locale (Java `toUpperCase(Locale.ROOT)`, C# `ToUpperInvariant()`: a Turkish locale would turn `i` into `İ`) | Remove whitespace at both ends. Recommended: normalise Unicode to NFC, so the same name typed twice is stored the same |
| Accept | 1 to 20 letters and digits after cleaning: `^[A-Z0-9]{1,20}$` | 1 to 200 characters after cleaning |
| Expected | One letter and six digits, `^[A-Z][0-9]{6}$` (for example R123456). Any other accepted SID is kept and can be listed for a check by hand (04, Q14). The screen may say what an SID usually looks like, but must not refuse an unusual one | |
| Refuse | Empty, longer than 20, or any other character (inner spaces, hyphens, dots) | Empty, or longer than 200 |
| Store | `respondent.sid`, unique | `respondent.full_name`, as typed: case, accents, hyphens and apostrophes kept |
| On return | Look the respondent up by SID | Keep the stored name unless you decide a new spelling should replace it |

The schema holds the stored form to these rules: `ck_respondent_sid`, `uq_respondent_sid`, `ck_respondent_full_name`.

Identity lives only in `respondent`, and answers reach it only through `submission.respondent_id`.

- **Restrict it:** grant SELECT on `respondent` to the few people who need names (example at the end of 01); analysts
  read `submission`, `answer` and `answer_item` without it.
- **Remove it**, keeping the answers: record when, then delete the respondent row.

  ```sql
  UPDATE submission SET identity_removed_at = CURRENT_TIMESTAMP
   WHERE respondent_id = (SELECT respondent_id FROM respondent WHERE sid = :sid);
  DELETE FROM respondent WHERE sid = :sid;
  ```

  The foreign key then sets `submission.respondent_id` to NULL; the run and its answers stay, linked to no one. `ON
  DELETE SET NULL` cannot also set the date, so the UPDATE comes first (a trigger on respondent could do it instead);
  `ck_submission_identity` refuses the delete if it is missing. A run can never be created without a respondent:
  `tg_submission_new` refuses a new run with no respondent, or with `identity_removed_at` already set. 05 tests all of
  these.
- **Erase the answers too:** find the run through the SID first, delete the submission (its answer, answer_item and
  answer_event rows go with it), then delete the respondent. In that order: once the respondent row is gone, nothing
  leads from the SID to the run.
- **When:** remove identities only after fieldwork closes. Until then, a removed person who typed their SID again would
  be a new respondent with no run, and could start a second one.

## Tables and columns

<!-- BEGIN GENERATED: tables (tools/build-sql.mjs) -->
### questionnaire

One row per version of the survey script. Answers always point at the version they were given under; a new script (new wording, steps or options) is a new version, never an edit of an old one.

| Column | Type | Meaning |
|---|---|---|
| `version` | varchar(10) NOT NULL | Version code, e.g. v3 (the third draft, after Adam's and Chris's notes of 15 Oct 2026). |
| `label` | varchar(200) NOT NULL | Plain-words name of this version. |
| `released` | date NOT NULL | Date of this version of the script. |
| `script_sha256` | char(64) NOT NULL | SHA-256 (lower-case hex) of the script.js file this version was loaded from, so the seed can be matched to the exact file. |

Keys and checks: `pk_questionnaire PRIMARY KEY (version)`; `ck_questionnaire_sha256 CHECK (script_sha256 ~ '^[0-9a-f]{64}$')`.

### step

Every screen of a questionnaire version, in play order: questions, follow-ups, chapter breaks, the welcome, the opening statement, the pause card and the ending. v3 has 77.

| Column | Type | Meaning |
|---|---|---|
| `version` | varchar(10) NOT NULL | Questionnaire version (questionnaire.version). |
| `step_id` | varchar(20) NOT NULL | Step id from script.js: 1.1, 2.2, 2.2a (a follow-up of 2.2), break-II, W (welcome), 0.1 (opening statement), pause, end. |
| `seq` | integer NOT NULL | Play order, 1 = the first screen after the identity screen (W, the welcome). |
| `kind` | varchar(20) NOT NULL | welcome, statement (0.1), break (chapter break), question, followup, pause or ending. |
| `template` | varchar(20) NOT NULL | The screen type, which fixes the shape of the saved answer: checklist, text, piles, podium, configure, track, trays, ladder, rank, sentence, stamp, allocate-ledger, allocate-list, bottle, newspaper; flow and break save nothing. |
| `chapter` | varchar(5) | Chapter numeral, I to X; NULL for the welcome, 0.1 and the ending. |
| `parent_step_id` | varchar(20) | For a follow-up, the question it follows (2.2a follows 2.2); NULL otherwise. |
| `title` | varchar(200) NOT NULL | Short title of the step, from the design's play order. |
| `bridge` | varchar(400) | The line shown above the question that leads into it, as written; NULL if none. |
| `question` | varchar(1000) | The question as written in script.js. Placeholders are kept: [X] and [N] are filled from earlier answers ($[X]mm on 4.1a and 5.2, [N] on 5.4a), {n} is a count filled when the screen loads, and [    ] or ________ marks the blank the respondent fills. |
| `instruction` | varchar(400) | The instruction under the question, as written; NULL if none. |
| `notes` | varchar(2000) | Grey notes under the instruction, one per line; NULL if none. (The context line "HNW client: $5-20mm liquid net worth" is added by the screen to every question and is not stored here.) |
| `show_condition` | varchar(400) | When a conditional step shows, in plain words (script.js previewCondition); NULL if it always shows. v3 has 11: 2.2a, 2.4, 2.4a, 2.5a, 4.3a, 5.4a, 6.2a, 6.3a, 7.2a, 8.1a, 8.4a. |
| `store` | varchar(40) | The design's store name for the answer (script.js data.store), e.g. products for 2.2; NULL for steps that save nothing. |
| `completion_rule` | varchar(400) | What the respondent must do before Next moves on, in plain words (script.js rule). |
| `wave1_only` | boolean NOT NULL DEFAULT false | TRUE for a sensitive step (script.js sensitive): asked in wave 1 (senior leaders) only, dropped for the wave-2 market managers. v3: 4.4, 8.2, 8.2a, 8.3, 8.4, 8.4a, 8.4b. |

Keys and checks: `pk_step PRIMARY KEY (version, step_id)`; `uq_step_seq UNIQUE (version, seq)`; `fk_step_questionnaire FOREIGN KEY (version) REFERENCES questionnaire (version)`; `fk_step_parent FOREIGN KEY (version, parent_step_id) REFERENCES step (version, step_id)`; `ck_step_seq CHECK (seq >= 1)`; `ck_step_kind CHECK (kind IN ('welcome', 'statement', 'break', 'question', 'followup', 'pause', 'ending'))`; `ck_step_template CHECK (template IN ('flow', 'break', 'checklist', 'text', 'piles', 'podium', 'configure', 'track', 'trays', 'ladder', 'rank', 'sentence', 'stamp', 'allocate-ledger', 'allocate-list', 'bottle', 'newspaper'))`; `ck_step_parent CHECK ((kind = 'followup') = (parent_step_id IS NOT NULL))`.

### step_option

Every choice a step offers, and the other named parts of a step that answers point to (fields, slots, rows, roles). Top-3 follow-ups (2.2a, 2.5a, 6.3a, 7.2a) and 8.1a have no rows here: they offer their parent's cards, so their answers point at the parent's card rows.

| Column | Type | Meaning |
|---|---|---|
| `version` | varchar(10) NOT NULL | Questionnaire version. |
| `step_id` | varchar(20) NOT NULL | The step that offers the option. |
| `option_set` | varchar(20) NOT NULL | What kind of thing the option is (card, pile, option, stop, field, row ...). data-dictionary.md lists the vocabulary. option_id is unique within a step and set. |
| `option_id` | varchar(60) NOT NULL | The id as saved in answers and in answer_item.item_id or value_text (script.js id). For 9.4b markets it is the market name itself, and for 10.3's chip and suggestions the text they put in the field. |
| `label` | varchar(400) | Label shown to the respondent, as written. For fields, the stem above the box; for sentence slots, the sentence with each slot in brackets. |
| `hint` | varchar(400) | Smaller line under the label (a pile's gloss; a 2.3 part's question); NULL if none. |
| `grp` | varchar(100) | Group printed above the label: the four card groups of 2.5 (The relationship, Specialist resources, Planning and reporting, Family and life events); NULL elsewhere. |
| `parent_option_id` | varchar(60) | The option of the same step this one sits under: a 2.3 part option's part (belongs, covers, who), a 9.4b market's region, a word chip's slot (4.2: verb), 10.3's chip and suggestions' field (name). NULL otherwise. |
| `seq` | integer NOT NULL | Order as written in script.js, from 1, within the step, set and parent_option_id. The screen may shuffle it; a track's stops and a podium's ranks keep it. |
| `extra_json` | text | Other properties of the option from script.js, as a JSON object (NULL if none), e.g. {"only":["execute"]} on 2.3's who options, {"always":true} on 2.6's business-banking tile, {"role":true} on 4.3's role cards, {"sensitive":true} on 8.1's price-list card (dropped in wave 2), the number range of a slot or role, a text field's limit. |

Keys and checks: `pk_step_option PRIMARY KEY (version, step_id, option_set, option_id)`; `fk_step_option_step FOREIGN KEY (version, step_id) REFERENCES step (version, step_id) ON DELETE CASCADE`; `ck_step_option_set CHECK (option_set IN ('option', 'fallback', 'region', 'market', 'other', 'field', 'chip', 'suggestion', 'card', 'pile', 'item', 'part', 'part_option', 'stop', 'end', 'tray', 'tile', 'row', 'column', 'block', 'slot', 'opt_out', 'role', 'stamp', 'jug'))`; `ck_step_option_seq CHECK (seq >= 1)`; `ck_step_option_extra CHECK (extra_json IS JSON OBJECT)`.

### respondent

Who answered: one row per person, typed on the identity screen before the welcome. Answers reach this table only through submission.respondent_id. Deleting a row removes the identity and leaves the answers (submission.respondent_id becomes NULL).

| Column | Type | Meaning |
|---|---|---|
| `respondent_id` | uuid NOT NULL DEFAULT gen_random_uuid() | Surrogate key: a random UUID (gen_random_uuid() or the like), never derived from the SID or the name, so it reveals nothing once the identity is removed. The only link from answers to identity. |
| `sid` | varchar(20) NOT NULL | J.P. Morgan Standard ID as typed, stored trimmed and upper-cased. Usually one letter and six digits (R123456, pattern ^[A-Z][0-9]{6}$); any 1 to 20 letters and digits are accepted, so an unusual SID is kept and can be checked by hand. Unique. |
| `full_name` | varchar(200) NOT NULL | Full name as typed, trimmed of leading and trailing spaces, 1 to 200 characters; case and spelling as entered. |
| `created_at` | timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP | When the identity screen was first submitted. |

Keys and checks: `pk_respondent PRIMARY KEY (respondent_id)`; `uq_respondent_sid UNIQUE (sid)`; `ck_respondent_sid CHECK (sid ~ '^[A-Z0-9]{1,20}$')`; `ck_respondent_full_name CHECK (char_length(full_name) BETWEEN 1 AND 200 AND full_name !~ '^\s' AND full_name !~ '\s$')`.

### submission

One run through the survey by one respondent. One run per person, ever (ux_submission_respondent): a returning respondent resumes their run under the version it started with, or is thanked if it is submitted; a run is created, under the current version, only when they have none.

| Column | Type | Meaning |
|---|---|---|
| `submission_id` | uuid NOT NULL DEFAULT gen_random_uuid() | Surrogate key: a random UUID (gen_random_uuid() or the like), never derived from the SID or the name. |
| `respondent_id` | uuid | Who (respondent.respondent_id). NULL only after the respondent's identity was removed, and then identity_removed_at says when (ck_submission_identity). |
| `version` | varchar(10) NOT NULL | The questionnaire version the run started under; it keeps it to the end. |
| `status` | varchar(12) NOT NULL DEFAULT 'in_progress' | in_progress until Send on the last question (10.5), then submitted. Analyses normally read submitted only. |
| `started_at` | timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP | When the submission was created (the identity screen was passed). |
| `last_saved_at` | timestamp with time zone | When any answer was last saved; for reminders and for spotting abandoned runs. |
| `submitted_at` | timestamp with time zone | When Send was pressed on 10.5; NULL while in progress. |
| `last_step_id` | varchar(20) | The step the respondent was last on, where a resume reopens (a follow-up reopens its parent first). |
| `device` | varchar(10) | laptop, phone or tablet, as last seen (the survey lays out for laptop from 1280x650 up, for phone below); NULL if unknown. |
| `identity_removed_at` | timestamp with time zone | When the respondent's identity was removed; NULL while it is kept, and always NULL on a new run (tg_submission_new). Set it before deleting the respondent row: the delete sets respondent_id to NULL, which ck_submission_identity allows only once this is set. |

Keys and checks: `pk_submission PRIMARY KEY (submission_id)`; `uq_submission_id_version UNIQUE (submission_id, version)`; `fk_submission_respondent FOREIGN KEY (respondent_id) REFERENCES respondent (respondent_id) ON DELETE SET NULL`; `fk_submission_questionnaire FOREIGN KEY (version) REFERENCES questionnaire (version)`; `fk_submission_last_step FOREIGN KEY (version, last_step_id) REFERENCES step (version, step_id)`; `ck_submission_status CHECK (status IN ('in_progress', 'submitted'))`; `ck_submission_submitted CHECK ((status = 'submitted') = (submitted_at IS NOT NULL))`; `ck_submission_times CHECK (submitted_at IS NULL OR submitted_at >= started_at)`; `ck_submission_device CHECK (device IN ('laptop', 'phone', 'tablet'))`; `ck_submission_identity CHECK (respondent_id IS NOT NULL OR identity_removed_at IS NOT NULL)`.

Indexes: `ux_submission_respondent UNIQUE (respondent_id) WHERE respondent_id IS NOT NULL`; `ix_submission_version_status (version, status)`.

Trigger `tg_submission_new BEFORE INSERT, check_new_submission()`: Refuses a new run (insert) without a respondent, or with identity_removed_at already set. Removing an identity later is an update, which ck_submission_identity governs.

### answer

One row per step answered (and per step passed without showing: see shown), holding the answer exactly as the screen saved it. The source of truth; answer_item is derived from it.

| Column | Type | Meaning |
|---|---|---|
| `submission_id` | uuid NOT NULL | The submission (submission.submission_id). |
| `version` | varchar(10) NOT NULL | Same as submission.version; carried here so step_id can reference step. |
| `step_id` | varchar(20) NOT NULL | The step answered. Steps that save nothing (welcome, 0.1, breaks, pause, end) have no rows. |
| `value_json` | text | The answer exactly as the screen saved it, as JSON text: a string, a number, a list or an object, per the step's template (data-dictionary.md). A bare string ("goals" on 1.1) or number (60 on 7.1) is a valid answer, so the JSON check must accept scalars. Stored as text so the key order survives: a card sort's keys are in placement order. Do not convert to jsonb, which sorts keys. NULL when the step was not shown, or shown and left empty (10.4 is optional; 5.2 has nothing to place when 5.1's split is $10mm). |
| `shown` | boolean NOT NULL DEFAULT true | FALSE for a step the respondent passed without seeing it: a conditional step that did not fire (e.g. 2.2a when Critical holds 3 cards or fewer), or a wave-1-only step in wave 2. Written when they pass it; value_json is then NULL. TRUE otherwise. |
| `first_saved_at` | timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP | When this row was first written. |
| `saved_at` | timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP | When this row was last written. |
| `revision` | integer NOT NULL DEFAULT 1 | How many times this row has been written, from 1. Matches the latest answer_event.revision when events are kept. |

Keys and checks: `pk_answer PRIMARY KEY (submission_id, step_id)`; `fk_answer_submission FOREIGN KEY (submission_id, version) REFERENCES submission (submission_id, version) ON DELETE CASCADE`; `fk_answer_step FOREIGN KEY (version, step_id) REFERENCES step (version, step_id)`; `ck_answer_value_json CHECK (value_json IS JSON)`; `ck_answer_shown CHECK (shown OR value_json IS NULL)`; `ck_answer_revision CHECK (revision >= 1)`; `ck_answer_times CHECK (saved_at >= first_saved_at)`.

Indexes: `ix_answer_step (version, step_id)`.

Trigger `tg_answer_submitted BEFORE INSERT OR UPDATE, refuse_write_to_submitted_run()`: OPTIONAL. Refuses inserts and updates of answer rows whose run is submitted (used by the tg_*_submitted triggers). A rebuild of answer_item for submitted runs disables tg_answer_item_submitted inside its own transaction (data-dictionary.md, "Rebuilding answer_item").

### answer_item

The answers in long format, one row per atomic element, for analysis in any SQL engine. Derived from answer.value_json by flatten() in tools/flatten.mjs (mapping in data-dictionary.md); rewrite a step's rows whenever its answer changes, in the same transaction.

| Column | Type | Meaning |
|---|---|---|
| `submission_id` | uuid NOT NULL | The submission. |
| `step_id` | varchar(20) NOT NULL | The step answered. |
| `item_id` | varchar(60) NOT NULL | What the row is about: a card, option, stop, field, row, role, slot, tile, block, jug, or a 2.3 way of investing. A step_option of the step (or, for 2.2a, 2.5a, 6.3a, 7.2a and 8.1a, of the parent). |
| `attribute` | varchar(20) NOT NULL | What the value is: choice, region, market, text, pile, rank, belongs, covers, who, stop, percent, tray, amount_mm, number, chip, opt_out, stamp or count. |
| `value_text` | varchar(4000) | Text value: the pile, stamp, tray, word chip or 2.3 option chosen for the item, the typed text (trimmed; 10.5 cleaned as its page cleans it), or the 9.4b market. On 10.3's chip row, the chip's text (no one). NULL when the value is a number or the item itself is the choice. |
| `value_number` | numeric(14,4) | Number value: a rank (1 = first), a per cent, an amount in $mm, a count, a typed number, or a stop's position on its scale (1 = first stop). |
| `seq` | integer NOT NULL | Position, from 1: the order cards were placed (card sorts); the order saved for trays and stamp decks (a revisit may rewrite it); the rank (podium, rank); the order picked (pick one or two); the position in 2.3's covers list; for other records the order of value_json's keys; 1 for a single value. |

Keys and checks: `pk_answer_item PRIMARY KEY (submission_id, step_id, item_id, attribute, seq)`; `fk_answer_item_answer FOREIGN KEY (submission_id, step_id) REFERENCES answer (submission_id, step_id) ON DELETE CASCADE`; `ck_answer_item_attribute CHECK (attribute IN ('choice', 'region', 'market', 'text', 'pile', 'rank', 'belongs', 'covers', 'who', 'stop', 'percent', 'tray', 'amount_mm', 'number', 'chip', 'opt_out', 'stamp', 'count'))`; `ck_answer_item_seq CHECK (seq >= 1)`.

Indexes: `ix_answer_item_step (step_id, attribute, item_id)`.

Trigger `tg_answer_item_submitted BEFORE INSERT OR UPDATE, refuse_write_to_submitted_run()`: OPTIONAL. Refuses inserts and updates of answer rows whose run is submitted (used by the tg_*_submitted triggers). A rebuild of answer_item for submitted runs disables tg_answer_item_submitted inside its own transaction (data-dictionary.md, "Rebuilding answer_item").

### answer_event

OPTIONAL. Append-only log of every save of every answer: never updated or deleted (except with its submission). Lets analysts study changes of mind, e.g. a card sorted, undone and sorted again.

| Column | Type | Meaning |
|---|---|---|
| `event_id` | bigint GENERATED ALWAYS AS IDENTITY | Surrogate key, increasing in the order saves arrive. |
| `submission_id` | uuid NOT NULL | The submission. |
| `step_id` | varchar(20) NOT NULL | The step. |
| `revision` | integer NOT NULL | answer.revision after this save. |
| `value_json` | text | The answer as saved by this save (same format as answer.value_json); NULL if the save cleared it. |
| `committed` | boolean NOT NULL DEFAULT false | TRUE when Next left the screen (a commit); FALSE for an autosave while the respondent was still on it (a draft). |
| `saved_at` | timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP | When the save reached the server. |

Keys and checks: `pk_answer_event PRIMARY KEY (event_id)`; `uq_answer_event_revision UNIQUE (submission_id, step_id, revision)`; `fk_answer_event_answer FOREIGN KEY (submission_id, step_id) REFERENCES answer (submission_id, step_id) ON DELETE CASCADE`; `ck_answer_event_value_json CHECK (value_json IS JSON)`; `ck_answer_event_revision CHECK (revision >= 1)`.

Indexes: `ix_answer_event_submission (submission_id, step_id, revision)`.

Trigger `tg_answer_event_submitted BEFORE INSERT OR UPDATE, refuse_write_to_submitted_run()`: OPTIONAL. Refuses inserts and updates of answer rows whose run is submitted (used by the tg_*_submitted triggers). A rebuild of answer_item for submitted runs disables tg_answer_item_submitted inside its own transaction (data-dictionary.md, "Rebuilding answer_item").

<!-- END GENERATED: tables -->

## step_option: the option_set vocabulary

Every choice a step offers is a row of `step_option`, and so is every other named part of a step that an answer points
to (a text field, a sentence slot, a ledger row, a role). `option_set` says what kind of thing the row is.
`option_id` is the id as saved in answers, unique within the version, step and set. `seq` is the order in script.js,
within the step, set and `parent_option_id`.

<!-- BEGIN GENERATED: option sets (tools/build-sql.mjs) -->
| option_set | What it is | Steps (rows) |
|---|---|---|
| `option` | A choice in a list: tap one, pick one or two, a trade-off pair (1.1-1.4); 3.2's own ten podium options | 1.1 (2), 1.2 (2), 1.3 (2), 1.4 (2), 2.4a (6), 3.2 (10), 4.1a (4), 4.4 (4), 5.2a (7), 5.3a (7), 6.1 (4), 6.2a (6), 8.2 (5), 8.2a (4), 8.4 (7), 9.3 (4) |
| `fallback` | 8.2a's fallback question's options, for use only if Comp 2.0 may not be named (not live in v3) | 8.2a (3) |
| `region` | 9.4b: a region (Asia; Europe, Middle East and Africa; Latin America) | 9.4b (3) |
| `market` | 9.4b: a listed market. option_id is the market name as saved; parent_option_id is its region | 9.4b (18) |
| `other` | 9.4b: Another market, whose name the respondent types | 9.4b (1) |
| `field` | A text field: 2.1, 10.1-10.4 (label = the stem above the box) and 10.5 (headline, quote). extra_json has the limit | 2.1 (3), 10.1 (2), 10.2 (1), 10.3 (2), 10.4 (1), 10.5 (2) |
| `chip` | A word chip: 4.2's verb (parent_option_id = the slot, verb); 10.3's "No one does it well", whose option_id is the text it writes into the name field ("no one") | 4.2 (3), 10.3 (1) |
| `suggestion` | 10.3: a competitor name the type-ahead suggests (extra_json lists the regions it is suggested in) | 10.3 (44) |
| `card` | A card: of a card sort (2.2, 2.5, 6.3, 7.2) or a stamp deck (4.3, 7.4, 8.1, 8.3, 9.2) | 2.2 (15), 2.5 (12), 4.3 (10), 6.3 (12), 7.2 (12), 7.4 (8), 8.1 (12), 8.3 (5), 9.2 (10) |
| `pile` | A pile of a card sort: not-hnw, nice, core, critical (hint = the pile's gloss) | 2.2 (4), 2.5 (4), 6.3 (4), 7.2 (4) |
| `item` | 2.3: a way of investing (execute, engage, entrust) | 2.3 (3) |
| `part` | 2.3: one of the three parts answered for each way of investing (belongs, covers, who) | 2.3 (3) |
| `part_option` | 2.3: an option of a part; parent_option_id is the part. extra_json "only" limits a who option to some items | 2.3 (20) |
| `stop` | A stop on a track (a scale); seq is its position from the left | 2.4 (5), 6.2b (6), 7.1 (11), 7.3 (5), 8.4a (5), 8.4b (5), 9.4a (7) |
| `end` | The words at either end of a track (2.4, 7.1): first and last. A label, not a choice | 2.4 (2), 7.1 (2) |
| `tray` | A tray of 2.6 or 5.3 | 2.6 (4), 5.3 (3) |
| `tile` | A tile to put in a tray. 2.6's business-banking tile is always offered (extra_json "always") | 2.6 (6), 5.3 (10) |
| `row` | A row: of 3.1's ladder, 5.1-5.2's ledger, 5.4a's list | 3.1 (5), 5.1 (7), 5.2 (7), 5.4a (9) |
| `column` | 3.1: the share set on the column, base (today's offer) and four (the first four rows together) | 3.1 (2) |
| `block` | A block to rank (3.3, 9.1) | 3.3 (10), 9.1 (10) |
| `slot` | A blank in a sentence: a number box or a word-chip group, and 5.1's split. label = the sentence, slots in brackets; extra_json has the range | 4.1 (1), 4.2 (2), 5.1 (1), 5.4 (1), 6.1a (1), 6.2 (2), 6.4a (1), 7.4a (1), 9.4 (1) |
| `opt_out` | 4.2's "Never", saved instead of the sentence | 4.2 (1) |
| `role` | 4.3a: a role (one of 4.3's role cards) that can get its own amount; extra_json has the range | 4.3a (5) |
| `stamp` | A stamp of a stamp deck; extra_json has its impression (the word it prints) and glyph | 4.3 (3), 7.4 (4), 8.1 (3), 8.3 (3), 9.2 (3) |
| `jug` | 6.4: a seniority jug (md, ed, vp, associate) | 6.4 (4) |
<!-- END GENERATED: option sets -->

Where options come from another step:

- **Top-3 follow-ups (2.2a, 2.5a, 6.3a, 7.2a) have no options of their own.** They offer the parent's cards that are in
  its Critical pile, in the order they were placed (a podium up to 8 cards, a fanned pile above that; the saved shape is
  the same). Their `answer_item.item_id` joins to the parent's `card` rows. **8.1a** is the same: it offers 8.1's cards
  stamped Do it or Pilot it.
- **2.3, part 2 (covers)** lists nine products, and the screen offers only those not put in Not for HNW on 2.2 (none
  left: the part is skipped and counts as done).
- **2.6's tiles** are the six listed, less the products put in Not for HNW on 2.2, plus business-banking, which is
  always offered.
- **4.3a's roles** are 4.3's five role cards (`extra_json` `{"role":true}` there), in 4.3a's own words; one row shows
  for each role stamped Only above an amount on 4.3.

## answer_item: from value_json to rows

`answer.value_json` holds the answer exactly as the screen saved it; `answer_item` holds it as rows, one per atomic
element, for analysis in any SQL engine. `flatten()` in `tools/flatten.mjs` is the reference; port it as it is.

- `item_id` is always an `option_id` of the step, or of its parent for 2.2a, 2.5a, 6.3a, 7.2a and 8.1a. Where
  `value_text` names a pile, stamp, tray, word chip or 2.3 option, that is an `option_id` of the step too. (05 checks
  every row; `refs()` lists which set each attribute points to.)
- `seq`: an array element's position (podium and rank: the rank; pick one or two: the order picked; 2.3's covers: the
  list's order); an object key's position (card sorts: the order placed; trays and stamp decks: the order saved,
  which a revisit to the screen may rewrite, so not a placement order; other records: the order saved); 1 for a
  single value (one choice, a stop, 2.3's belongs and who, 9.4b's region and market).
- Text is trimmed, and an empty text field gives no row. 10.5's headline and quote are cleaned as its page cleans them.
- Amounts behind a closed ledger column give no rows: 5.1's rows while its split is 0 (or not typed), and 5.2's rows
  when 5.1's split is 10. The second needs `ctx.answers['5.1']`; without it, 5.2's rows are kept.
- 10.3: when the name is exactly `no one` (what the chip "No one does it well" writes), there is a `chip` row beside
  the `text` row. Typing those exact words gives the same rows: nothing saved tells them apart.
- A step not shown, or shown and left without a value, gives no rows.
- Rewrite a step's rows whenever its answer changes, in the same transaction as the answer.
- Read answer_item through `answer` and keep `a.shown` only, as every query in 04 does
  (`JOIN answer a ON a.submission_id = ai.submission_id AND a.step_id = ai.step_id AND a.shown`). By the rules above a
  step that did not show has no answer_item rows; the filter keeps a row left behind by mistake out of the counts.

| attribute | Value column | Meaning | Steps |
|---|---|---|---|
| `choice` | (none: `item_id` is the choice) | The option picked | 1.1-1.4, 2.4a, 4.1a, 4.4, 5.2a, 5.3a, 6.1, 6.2a, 8.2, 8.2a, 8.4, 9.3; 8.1a (a card of 8.1) |
| `region` | (none: `item_id` is the region) | The region picked | 9.4b |
| `market` | `value_text` | The market as saved; `item_id` is the listed market's name, or `other` for a typed one | 9.4b |
| `text` | `value_text` | Typed text, trimmed (10.5: cleaned as its page cleans it) | 2.1, 10.1-10.4, 10.5 |
| `pile` | `value_text` | The pile the card was put in | 2.2, 2.5, 6.3, 7.2 |
| `rank` | `value_number` | 1 = first | 2.2a, 2.5a, 6.3a, 7.2a, 3.2 (top 3); 3.3, 9.1 (1-10) |
| `belongs` | `value_text` | Where the way of investing belongs (a pile) | 2.3 |
| `covers` | `value_text` | A product it covers, one row each | 2.3 |
| `who` | `value_text` | Who the client mainly deals with | 2.3 |
| `stop` | `value_number` | The stop's position on its scale (1 = the first stop); `item_id` is the stop | 2.4, 6.2b, 7.3, 8.4a, 8.4b, 9.4a |
| `percent` | `value_number` | Per cent | 3.1 (shares of wallet), 5.4a (shares of clients), 7.1 (contact without a banker) |
| `tray` | `value_text` | The tray the tile was put in | 2.6, 5.3 |
| `amount_mm` | `value_number` | US$ millions | 4.1, 4.2, 4.3a, 5.1, 5.2 |
| `number` | `value_number` | A typed count (clients, meetings, bankers) | 5.4, 6.1a, 6.2, 6.4a, 7.4a, 9.4 |
| `chip` | `value_text` | 4.2: the word picked for the slot `item_id` (verb). 10.3: the chip "No one does it well" filled the name (`item_id` name, `value_text` `no one`) | 4.2, 10.3 |
| `opt_out` | (none) | 4.2's Never was picked instead of the sentence | 4.2 |
| `stamp` | `value_text` | The stamp the card got | 4.3, 7.4, 8.1, 8.3, 9.2 |
| `count` | `value_number` | Bankers in the jug | 6.4 |

## Conditional steps (answer.shown)

Eleven steps show only in some runs. `shows()` holds each rule; `step.show_condition` holds the same words.

| Step | Shows only if | The rule in shows() |
|---|---|---|
| 2.2a, 2.5a, 6.3a, 7.2a | Critical holds more than 3 cards | count of the parent's cards with pile `critical` > 3 |
| 2.4 | Engage or Entrust is not put in Not for HNW on 2.3 | `engage.belongs` or `entrust.belongs` on 2.3 is set and not `not-hnw` |
| 2.4a | 2.4 is shown | the same rule as 2.4 |
| 4.3a | a role (banker, investment specialist resource, WA, CA or CSS) is stamped Only above an amount | any of `banker`, `investor`, `wa`, `ca`, `css` stamped `above` on 4.3 |
| 5.4a | the answer to 5.4 is more than 0 | 5.4's `n` > 0 |
| 6.2a | either number on 6.2 is 1 or more | 6.2's `first` >= 1 or `after` >= 1 |
| 8.1a | two or more cards are stamped Do it or Pilot it | count of 8.1's cards stamped `do` or `pilot` >= 2 |
| 8.4a | the answer to 8.4 is A revenue share for some years | 8.4 = `trailer` |

The second sample respondent, R000002, sees none of the eleven, so 03 holds a `shown = false` row for each and 05 checks
the queries that read them.

Wave 2 (market managers) is not asked the seven steps marked `wave1_only` (4.4, 8.2, 8.2a, 8.3, 8.4, 8.4a, 8.4b), and
8.1 drops its price-list card (`extra_json` `{"sensitive":true}`), leaving 11 cards. `shows()` and `validate()` apply
this when called with `ctx.wave = 2`.

## Every step

One row per step, in play order. The example is R000001's answer, shortened; the full values of both sample runs are in
`sql/03-sample-respondent.sql`. The count in brackets is how many answer_item rows R000001's answer gives.

<!-- BEGIN GENERATED: steps (tools/build-sql.mjs) -->
| Step | Kind | Template | Question (short) | value_json holds | Example (R000001) | answer_item rows (R000001's count) |
|---|---|---|---|---|---|---|
| W | welcome | flow | Welcome | Nothing (no answer row) |  |  |
| 0.1 | statement | flow | This survey is about the opportunity to cover HNW clients, who have $5-20mm of liquid … | Nothing (no answer row) |  |  |
| break-I | break | break | Chapter break | Nothing (no answer row) |  |  |
| 1.1 | question | checklist | The core of a $5-20mm relationship is ________. | One option id, of 2 | `"goals"` | item_id = the option, attribute choice (1) |
| 1.2 | question | checklist | HNW clients most value ________ in their banking providers. | One option id, of 2 | `"attention"` | item_id = the option, attribute choice (1) |
| 1.3 | question | checklist | When a $5-20mm client chooses us, it's mostly for ________. | One option id, of 2 | `"banker"` | item_id = the option, attribute choice (1) |
| 1.4 | question | checklist | For a $5-20mm client, investment advice works better from ________. | One option id, of 2 | `"central-team"` | item_id = the option, attribute choice (1) |
| break-II | break | break | Chapter break | Nothing (no answer row) |  |  |
| 2.1 | question | text | When those clients are asked what drew them to J.P. Morgan, they consistently say: | `{ r1, r2, r3 }`: text of up to 280 / 280 / 280 characters | `{"r1":"I trust the name. It fe…","r2":"My banker knows my fami…","r3":"I can invest in things …"}` | One per field with text: item_id = the field, attribute text, value_text = the text, trimmed (3) |
| 2.2 | question | piles | Where does each product belong in our offer for $5-20mm clients? | `{ cardId: pileId }` for all 15 cards, keys in the order placed | `{"securities":"critical","funds":"core","core-offering":"core", …12 more}` | One per card: item_id = the card, attribute pile, value_text = the pile, seq = order placed (15) |
| 2.2a | followup, conditional | podium | Which three products matter most to winning? | `[1st, 2nd, 3rd]`: cards of 2.2 that were put in Critical to winning; `null` for an empty place | `["securities","alternatives","lombard"]` | One per place filled: item_id = the card (a card of 2.2), attribute rank, value_number = seq = 1, 2, 3 (3) |
| 2.3 | question | configure | How would each way of investing work for a $5-20mm client? | `{ execute, engage, entrust }`, each `{ belongs, covers: [], who }`; Not for HNW saves `{ belongs: "not-hnw", covers: [], who: null }` | `{"execute":{"belongs":"core","covers":["securities","funds"],"who":"online"},"engage":{"belongs":"critical","covers":["funds","core-offering","structured"],"who":"central"},"entrust":{"belongs":"core","covers":["core-offering","alternatives"],"who":"banker-alone"}}` | Per item (execute, engage, entrust): attribute belongs, value_text; one covers row per product, value_text, seq; attribute who, value_text (13) |
| 2.4 | question, conditional | track | For advisory and discretionary portfolios, how much customisation would you offer a … | One stop id, of 5 | `"building-blocks"` | item_id = the stop, attribute stop, value_number = its position on the scale (1) |
| 2.4a | followup, conditional | checklist | How many standard risk profiles would you offer these clients? | One option id, of 6 | `"4"` | item_id = the option, attribute choice (1) |
| 2.5 | question | piles | Where does each service belong in our offer for $5-20mm clients? | `{ cardId: pileId }` for all 12 cards, keys in the order placed | `{"named-banker":"critical","investor":"critical","wealth-plan":"core", …9 more}` | One per card: item_id = the card, attribute pile, value_text = the pile, seq = order placed (12) |
| 2.5a | followup, conditional | podium | Which three matter most to winning? | `[1st, 2nd, 3rd]`: cards of 2.5 that were put in Critical to winning; `null` for an empty place | `["named-banker","investor","whole-wealth"]` | One per place filled: item_id = the card (a card of 2.5), attribute rank, value_number = seq = 1, 2, 3 (3) |
| 2.6 | question | trays | If clients want these, who is best placed to provide them? | `{ tileId: trayId }` for every tile offered (those not put in Not for HNW on 2.2, plus business-banking); keys in save order, which a revisit may rewrite | `{"banking":"jpm","mortgage":"pb","insurance":"partner", …2 more}` | One per tile: item_id = the tile, attribute tray, value_text = the tray, seq = save order (5) |
| break-III | break | break | Chapter break | Nothing (no answer row) |  |  |
| 3.1 | question | ladder | A typical $10mm client chooses us. With today's offer, what share of their money would … | `{ base, banking, mortgage, retirement, insurance, alternatives, four }`: whole per cents; rows and four at or above base | `{"base":40,"banking":50,"mortgage":55, …4 more}` | One per key: item_id = base, a row or four, attribute percent, value_number (7) |
| 3.2 | question | podium | Why would a $5-20mm client move money to us rather than to their main bank? | `[1st, 2nd, 3rd]`: ids of its 10 options; `null` for an empty place | `["banker","alternatives","safety"]` | One per place filled: item_id = the option, attribute rank, value_number = seq = 1, 2, 3 (3) |
| 3.3 | question | rank | What makes a $5-20mm client feel most special with us? | `[blockId, ...]`, all 10, rank 1 first | `["calls-first","meetings","leaders","first-look","intellectual-capital","brand","next-gen","events","offices","gifts"]` | One per block: item_id = the block, attribute rank, value_number = seq = the rank (10) |
| break-IV | break | break | Chapter break | Nothing (no answer row) |  |  |
| 4.1 | question | sentence | In my market, any client with more than $[ ]mm would demand services consistent with an … | `{ mm }` (mm: $0.5-50mm) | `{"mm":5}` | item_id = mm, attribute amount_mm, value_number (1) |
| 4.1a | followup | checklist | Where does a client just below $[X]mm go? | One option id, of 4 | `"jpm-other"` | item_id = the option, attribute choice (1) |
| 4.2 | question | sentence | At $[ ]mm in balances with us, I would [offer · suggest · require] a move to UHNW … | `{ mm, verb }` (mm: $1-200mm; verb: offer, suggest, require), or `'never'` | `{"mm":15,"verb":"suggest"}` | item_id = mm, attribute amount_mm, value_number; item_id = verb, attribute chip, value_text = the word. Never: item_id = never, attribute opt_out (2) |
| 4.3 | question | stamp | Who gets each of these: every $5-20mm client, only those above an amount, or none? | `{ cardId: stampId }` for all 10 cards (every, above, none); keys in save order, which a revisit may rewrite | `{"banker":"above","investor":"none","wa":"above", …7 more}` | One per card: item_id = the card, attribute stamp, value_text = the stamp, seq = save order (10) |
| 4.3a | followup, conditional | sentence | From what amount does a client get each one? | `{ roleId: number }` for each role stamped Only above an amount on 4.3: $5-20mm, steps of 0.5 | `{"banker":10,"wa":15}` | One per role: item_id = the role, attribute amount_mm, value_number (2) |
| 4.4 | question, wave 1 only | checklist | Some IPB clients today have $5-20mm. What happens to them at launch? | One option id, of 4 | `"case-by-case"` | item_id = the option, attribute choice (1) |
| break-V | break | break | Chapter break | Nothing (no answer row) |  |  |
| 5.1 | question | allocate-ledger | A typical $10mm client chooses us. With today's offer, how is their money split, and who … | `{ split, rowId: $mm }`: split 0 to 10, and the rows add up to it. While the split is 0 (or not typed) the Banking and cash column is closed: any rows saved count as nothing | `{"split":4,"jpm":1,"champion":2, …2 more}` | One per key: item_id = split or a row, attribute amount_mm, value_number. With a split of 0, the split row only; with no split typed, none (5) |
| 5.2 | question | allocate-ledger | The other $[X]mm is invested. Who holds it? | `{ rowId: $mm }`: the rows add up to $10mm less 5.1's split. With a split of 10 there is nothing to place: any rows saved count as nothing | `{"jpm":3,"global":1.5,"independent":0.5, …1 more}` | One per key: item_id = a row, attribute amount_mm, value_number; none when 5.1's split is 10 (4) |
| 5.2a | followup | checklist | Whose clients would you try hardest to win? | One option id, of 7 | `"champion"` | item_id = the option, attribute choice (1) |
| 5.3 | question | trays | What will a $5-20mm client keep with their local bank, and what will they bring to us? | `{ tileId: trayId }` for all 10 tiles; keys in save order, which a revisit may rewrite | `{"day-to-day":"local","salary":"local","home-loan":"local", …7 more}` | One per tile: item_id = the tile, attribute tray, value_text = the tray, seq = save order (10) |
| 5.3a | followup | checklist | Where would you book that money? | One option id, of 7 | `"sg-hk"` | item_id = the option, attribute choice (1) |
| 5.4 | question | sentence | Three years after launch, I expect the IPB to have about [ ] clients with $5-20mm. | `{ n }` (n: 0 to 200,000) | `{"n":3000}` | item_id = n, attribute number, value_number (1) |
| 5.4a | followup, conditional | allocate-list | Where will those [N] clients come from? | `{ rowId: per cent }`: whole numbers adding up to 100 | `{"existing":30,"client-referrals":20,"introducers":10, …6 more}` | One per row typed: item_id = the row, attribute percent, value_number (9) |
| break-VI | break | break | Chapter break | Nothing (no answer row) |  |  |
| 6.1 | question | checklist | How would you cover a typical $5-20mm client? | One option id, of 4 | `"hybrid"` | item_id = the option, attribute choice (1) |
| 6.1a | followup | sentence | About how many clients can one HNW banker cover effectively? | `{ n }` (n: 10 to 500) | `{"n":80}` | item_id = n, attribute number, value_number (1) |
| 6.2 | question | sentence | The optimal number of in-person meetings with a client is [ ] in their first year and [ … | `{ first, after }` (first: 0 to 24; after: 0 to 24) | `{"first":4,"after":2}` | item_id = first, attribute number, value_number; item_id = after, attribute number, value_number (2) |
| 6.2a | followup, conditional | checklist | Where will most of those meetings take place? | A list of 1 or 2 option ids, in the order picked | `["jpm-office","business"]` | One per pick: item_id = the option, attribute choice, seq = order picked (2) |
| 6.2b | followup | track | How far from the client can the banker be based and still serve them well? | One stop id, of 6 | `"hour-2"` | item_id = the stop, attribute stop, value_number = its position on the scale (1) |
| 6.3 | question | piles | How much does each of these matter in the ideal HNW banker? | `{ cardId: pileId }` for all 12 cards, keys in the order placed | `{"technical":"core","eq":"critical","book":"nice", …9 more}` | One per card: item_id = the card, attribute pile, value_text = the pile, seq = order placed (12) |
| 6.3a | followup, conditional | podium | Which three matter most in an HNW banker? | `[1st, 2nd, 3rd]`: cards of 6.3 that were put in Critical to winning; `null` for an empty place | `["eq","opener","local-network"]` | One per place filled: item_id = the card (a card of 6.3), attribute rank, value_number = seq = 1, 2, 3 (3) |
| 6.4 | question | bottle | Picture a team of 10 HNW bankers. How senior do they need to be? | `{ md, ed, vp, associate }`: bankers, adding up to 10 | `{"md":1,"ed":3,"vp":4, …1 more}` | One per jug: item_id = the jug, attribute count, value_number (4) |
| 6.4a | followup | sentence | Of every 10 HNW bankers we add, how many could realistically come from inside J.P. Morgan? | `{ n }` (n: 0 to 10) | `{"n":6}` | item_id = n, attribute number, value_number (1) |
| break-VII | break | break | Chapter break | Nothing (no answer row) |  |  |
| 7.1 | question | track | Three years after launch, how much of a client's contact with us will happen without a … | A number from 0 to 100 in steps of 10 (per cent) | `60` | item_id = the stop (`60`), attribute percent, value_number = 60 (1) |
| 7.2 | question | piles | Which digital features does a $5-20mm offer need? | `{ cardId: pileId }` for all 12 cards, keys in the order placed | `{"remote-opening":"critical","one-view":"critical","aggregation":"nice", …9 more}` | One per card: item_id = the card, attribute pile, value_text = the pile, seq = order placed (12) |
| 7.2a | followup, conditional | podium | Which three matter most to winning? | `[1st, 2nd, 3rd]`: cards of 7.2 that were put in Critical to winning; `null` for an empty place | `["remote-opening","one-view","whatsapp"]` | One per place filled: item_id = the card (a card of 7.2), attribute rank, value_number = seq = 1, 2, 3 (3) |
| 7.3 | question | track | How much can AI do for an HNW banker, three years after launch? | One stop id, of 5 | `"co-pilot"` | item_id = the stop, attribute stop, value_number = its position on the scale (1) |
| 7.4 | question | stamp | Three years after launch, how will people and AI split the work at each step with a … | `{ cardId: stampId }` for all 8 cards (person, person-ai, ai-drafts, ai); keys in save order, which a revisit may rewrite | `{"onboarding":"ai-drafts","kyc":"person-ai","suitability":"person", …5 more}` | One per card: item_id = the card, attribute stamp, value_text = the stamp, seq = save order (8) |
| 7.4a | followup | sentence | With the AI you just described, how many clients can one HNW banker cover effectively? | `{ n }` (n: 10 to 1,000) | `{"n":120}` | item_id = n, attribute number, value_number (1) |
| break-VIII | break | break | Chapter break | Nothing (no answer row) |  |  |
| 8.1 | question | stamp | Would you make each of these price changes for $5-20mm clients? | `{ cardId: stampId }` for all 12 cards (do, pilot, never); keys in save order, which a revisit may rewrite | `{"free-online":"do","free-all":"never","free-crypto":"never", …9 more}` | One per card: item_id = the card, attribute stamp, value_text = the stamp, seq = save order (12) |
| 8.1a | followup, conditional | stamp | If we could pay for only one of these, which one? | One card id of 8.1, a card stamped `do` or `pilot` there | `"cash-rate"` | item_id = the card (a card of 8.1), attribute choice (1) |
| 8.2 | question, wave 1 only | checklist | How would you mainly pay HNW bankers? | One option id, of 5 | `"scorecard"` | item_id = the option, attribute choice (1) |
| 8.2a | followup, wave 1 only | checklist | Would Comp 2.0 work for HNW bankers? | One option id, of 4 | `"adapted"` | item_id = the option, attribute choice (1) |
| 8.3 | question, wave 1 only | stamp | Where do you stand on each of these changes to HNW bankers' pay? | `{ cardId: stampId }` for all 5 cards (do, pilot, never); keys in save order, which a revisit may rewrite | `{"team-pay":"pilot","salary-only":"never","nnm-bonus":"do", …2 more}` | One per card: item_id = the card, attribute stamp, value_text = the stamp, seq = save order (5) |
| 8.4 | question, wave 1 only | checklist | A banker's client grows into UHNW. What would you do for the banker? | One option id, of 7 | `"trailer"` | item_id = the option, attribute choice (1) |
| 8.4a | followup, conditional, wave 1 only | track | How long would you pay it for? | One stop id, of 5 | `"3"` | item_id = the stop, attribute stop, value_number = its position on the scale (1) |
| 8.4b | followup, wave 1 only | track | A colleague from another J.P. Morgan business refers a $5-20mm client to us. What credit … | One stop id, of 5 | `"scorecard"` | item_id = the stop, attribute stop, value_number = its position on the scale (1) |
| break-IX | break | break | Chapter break | Nothing (no answer row) |  |  |
| 9.1 | question | rank | What is most critical to winning $5-20mm clients? | `[blockId, ...]`, all 10, rank 1 first | `["talent","service-model","onboarding","products","digital","pay","referrals","pricing","training","bandwidth"]` | One per block: item_id = the block, attribute rank, value_number = seq = the rank (10) |
| 9.2 | question | stamp | Where does J.P. Morgan stand on each of these today? | `{ cardId: stampId }` for all 10 cards (ready, fixable, gap); keys in save order, which a revisit may rewrite | `{"bandwidth":"gap","digital":"fixable","talent":"fixable", …7 more}` | One per card: item_id = the card, attribute stamp, value_text = the stamp, seq = save order (10) |
| 9.3 | question | checklist | Under which name would you serve $5-20mm clients? | One option id, of 4 | `"named-tier"` | item_id = the option, attribute choice (1) |
| 9.4 | question | sentence | Five years after launch, I expect the IPB to have about [ ] clients with $5-20mm. | `{ n }` (n: 0 to 200,000) | `{"n":6000}` | item_id = n, attribute number, value_number (1) |
| 9.4a | followup | track | How many years would you give the HNW business to break even? | One stop id, of 7 | `"5"` | item_id = the stop, attribute stop, value_number = its position on the scale (1) |
| 9.4b | followup | checklist | Which client market would you start with? | `{ region, market }`: a region id and the name of one of its markets; for Another market, the typed name, with region `''` if none was tapped | `{"region":"emea","market":"United Arab Emirates"}` | item_id = the region, attribute region; and item_id = the market's name (or `other`), attribute market, value_text = the market (2) |
| break-X | break | break | Chapter break | Nothing (no answer row) |  |  |
| 10.1 | question | text | What excites you most about this, and what makes you most nervous? | `{ excited, nervous }`: text of up to 280 / 280 characters | `{"excited":"Reaching good clients w…","nervous":"That we build a cut-pri…"}` | One per field with text: item_id = the field, attribute text, value_text = the text, trimmed (2) |
| 10.2 | question | text | What do you fear we will get wrong again? | `{ fear }`: text of up to 600 characters | `{"fear":"We launch with too many…"}` | One per field with text: item_id = the field, attribute text, value_text = the text, trimmed (1) |
| 10.3 | question | text | The competitor that does this best is ________. | `{ name, why }`: text of up to 60 / 200 characters; the chip writes `no one` into name, with no flag of its own | `{"name":"UBS","why":"One clear offer for thi…"}` | One per field with text: item_id = the field, attribute text, value_text = the text, trimmed. When the name is exactly `no one` (the chip, or the same words typed): also item_id = name, attribute chip, value_text = `no one` (2) |
| 10.4 | question | text | Is there anything we didn't ask, or one thing you'd change about the HNW plan? | `{ last }`: text of up to 400 characters (optional) | `{"last":"Ask how we hand a clien…"}` | One per field with text: item_id = the field, attribute text, value_text = the text, trimmed (1) |
| pause | pause | flow | Pause card | Nothing (no answer row) |  |  |
| 10.5 | question | newspaper | When we launch, what headline would you like to see in your local newspaper? | `{ headline, quote }`: text of up to 110 and 220 characters, at least 10 and 10 once cleaned (line breaks to spaces, double spaces closed up, trimmed, quote marks off the quote's ends) | `{"headline":"J.P. Morgan opens its p…","quote":"Clients with $5mm now g…"}` | One per field with text: item_id = headline or quote, attribute text, value_text = the text cleaned as the page cleans it (2) |
| end | ending | flow | Ending and contact line | Nothing (no answer row) |  |  |
<!-- END GENERATED: steps -->

## Shapes worth knowing

- **Card sorts (2.2, 2.5, 6.3, 7.2):** the keys are in the order the cards were placed. Undo removes the last key; a
  card sent back from a pile and sorted again moves to the end. Keep `value_json` as text (never PostgreSQL `jsonb`,
  which sorts keys) and read it with an order-keeping JSON parser. No card id looks like an integer, the one kind of
  key JavaScript would move to the front.
- **Trays (2.6, 5.3) and stamp decks (4.3, 7.4, 8.1, 8.3, 9.2):** keys in the order saved. The preview rebuilds a
  restored answer in its shuffled display order, so a revisit can rewrite the order (see "Known preview issues"):
  don't read placement order from them.
- **Podium (2.2a, 2.5a, 6.3a, 7.2a, 3.2):** always an array of three places, `null` for an empty one, so a run in
  progress can hold `[null, "funds", null]`.
- **Rank (3.3, 9.1):** a partial save lists the blocks placed so far in ladder order with the gaps closed up, so its
  positions are not yet ranks. Complete means all ten.
- **2.3:** `{ execute, engage, entrust }`, in that order; an item is left out until one of its parts is answered.
  Not for HNW saves `{ belongs: "not-hnw", covers: [], who: null }`. `covers` keeps the list's order, not the order
  ticked. Some `who` options are for some items only (`extra_json` `only`): Execute offers online, desk, banker;
  Engage and Entrust offer online, banker-alone, central, central-direct, investor.
- **4.2:** Never saves the string `"never"`, not an object. Otherwise `{ mm, verb }`; amounts round to $0.5mm when the
  box is left.
- **4.3a:** keys are role ids, only for the roles stamped Only above an amount on 4.3, in card order; each an amount
  from $5mm to $20mm.
- **5.1:** `split` is the $mm in banking and cash (0 to 10, one decimal), and the rows must add up to it. A row never
  typed is left out; a row typed 0 is kept as 0. Key order follows the screen's (shuffled) row order. While the split
  is 0 (or not typed) the Banking and cash column is closed, but the preview still saves amounts typed there earlier
  (see "Known preview issues"): `validate()` and `flatten()` ignore them, so a split of 0 is complete and gives one row.
- **5.2:** the rows must add up to $10mm less 5.1's split. With a split of 10 there is nothing to place: the step is
  complete with `value_json` NULL, and its row is written when Next passes it, with `shown = true` (R000002 in 03). Any
  old amounts the preview still saves are ignored (this needs `ctx.answers['5.1']`; without it, the total is not
  checked and the rows are kept).
- **5.4a:** whole per cents adding up to exactly 100; a row never typed is left out and counts as 0.
- **7.1:** saves the number (`60`), not a string. Its answer_item row has `item_id` `'60'` (the stop chosen, so every
  answer is an option of the step, like any track's) and `value_number` 60. Because `item_id` carries the value, summarise
  7.1 by step, not by `item_id`: 04's Q18 groups it as one item.
- **8.1a:** one of 8.1's card ids, as a string, and only one stamped Do it or Pilot it there.
- **9.4b:** `{ region, market }`. A listed market is saved by its name (`"Hong Kong"`), not an id. Another market saves
  the typed name, with whatever region was selected, or `""` if none. Nothing else marks Another market: it is a market
  not in the region's list. That is how the screen reads it back and how `flatten()` decides `item_id = 'other'`.
- **10.3:** the chip No one does it well writes `no one` into the name field, with no flag of its own. A name of
  exactly `no one` gets a `chip` row in answer_item; typing those words cannot be told apart from the chip.
- **10.4:** optional. While it is empty Next reads Skip and nothing is saved; the step is complete without a value.
- **10.5:** headline and quote as the page cleans them: line breaks become spaces, runs of spaces close up, the ends
  are trimmed, and the quote loses any quote marks at either end. The minimums (10 characters each) count the cleaned
  text; `validate()` and `flatten()` apply the same clean-up, so a raw save from another build is read the same way.
- **Text fields** are saved with every field present (`""` when empty). Limits count characters as the browser's
  `maxlength` does (UTF-16 code units, JavaScript's `.length`); count the same way on the server.
- **Typed numbers** can be out of range in a draft while the respondent types (4.1 passes through `0` on the way to
  `0.5`). `validate()` reports a range miss as incomplete, not as an error.
- **Shapes the screens never save are errors:** `{}` for any object answer (an empty answer saves nothing); `[]` for
  6.2a, 3.3 or 9.1; a podium that is not exactly three places long; 6.4 without all four jugs (each is saved, 0
  included); a 9.4b market with spaces at either end.

## Known preview issues

Behaviours of the review preview's pages to know about. The real build should not copy the first two; the third shapes
the save rules. The pages are unchanged in this package; `validate()` and `flatten()` are written to cope with all three.

1. **Amounts saved behind a closed ledger column** (`preview/t-allocate-ledger.html`). `save()` (lines 450-458) writes
   every Banking and cash amount the respondent typed (line 454) and every Investments amount (line 456), whatever
   the split. Yet with 5.1's split at 0 the Banking and cash column is closed (`colState()`, line 464) and the page's
   own total counts it as zero (line 299); with 5.1's split at 10, 5.2 has nothing to place (lines 467 and 490) and
   still saves its old amounts. So `value_json` can hold amounts the respondent saw as zero. The real build must save
   nothing behind a closed column. Until then, `validate()` and `flatten()` ignore those amounts (5.2's case needs
   `ctx.answers['5.1']`).
2. **Trays and stamp decks lose their saved order on a revisit** (`preview/t-trays.html`, `preview/t-stamp.html`). A
   restored answer is rebuilt in the screen's shuffled display order: trays walk the tiles (t-trays.html line 177)
   and re-save on load when a tile is no longer offered (line 378); stamps walk the cards (t-stamp.html line 368) and
   re-save on every load (the first `draw()`, line 530, calls `ui.save` at line 461). The keys are then in display
   order, not the order placed or stamped. Fix: restore from `Object.keys(saved)`, as the card sorts do
   (t-piles.html line 341). Until then `seq` for trays and stamps means the order saved.
3. **Every change is saved at once** (all pages: `ui.save` on each change). The real build saves drafts as it goes too.
   So a parent's answer passes through states the respondent does not mean: in the middle of a card sort, Undo can
   leave Critical with three cards. That is why rows for steps that do not show are written only on a commit (Next) or
   at Send, never on a draft (see "How a run is stored").

## Answers that depend on earlier ones

| Earlier step | What reads it |
|---|---|
| 2.2 | 2.2a (the Critical pile; whether it shows), 2.3 part 2 (products not in Not for HNW), 2.6 (the tiles) |
| 2.3 | 2.4 and 2.4a (whether they show) |
| 2.5, 6.3, 7.2 | 2.5a, 6.3a, 7.2a (the Critical pile; whether it shows) |
| 3.1 and 4.1 | 4.2's soft check (a grey line only; nothing stored) |
| 4.1 | 4.1a's question ($[X]mm) |
| 4.3 | 4.3a (one row per role stamped Only above an amount; whether it shows) |
| 5.1 | 5.2 (what must be placed; its question) |
| 5.4 | 5.4a ([N]; whether it shows) |
| 6.2 | 6.2a (whether it shows) |
| 8.1 | 8.1a (the lines offered; whether it shows) |
| 8.4 | 8.4a (whether it shows) |
| 9.1 | the ending's "what you said it takes" (the first three; nothing stored) |

When a later screen is shown again, it drops what is no longer offered (a top-3 pick no longer in Critical, a 2.3
product since put in Not for HNW). Don't rely on that on the server: re-run `shows()` and `validate()` over all the
answers at Send.

## Porting notes: SQL Server and Oracle

The schema keeps to types every engine has. What changes:

| | PostgreSQL 16 (here) | SQL Server (2016 or later) | Oracle (19c or later) |
|---|---|---|---|
| UUID keys. In every engine the keys are random, never derived from the SID or the name | `uuid`, `DEFAULT gen_random_uuid()` | `uniqueidentifier`, `DEFAULT NEWID()` | A version 4 UUID generated in the application from a cryptographically secure source (for example Java's `UUID.randomUUID()`), stored as `CHAR(36)` or `RAW(16)` |
| JSON as text (`value_json`, `extra_json`). A bare string (`"goals"` on 1.1) or number (`60` on 7.1) is a valid stored answer, so the check must accept JSON scalars | `text` with `CHECK (value_json IS JSON)`, which accepts scalars (new in 16; on 15 or older, `CHECK ((value_json::json) IS NOT NULL)` refuses bad JSON with an error). Never `jsonb`: it sorts keys and loses the placement order | `nvarchar(max)`. 2022 and later: `CHECK (ISJSON(value_json, VALUE) = 1)`. 2016 to 2019: `ISJSON(value_json) = 1` accepts only an object or an array, so wrap the value: `CHECK (ISJSON(CONCAT(N'[', value_json, N']')) = 1)`. The wrapper also lets through two values such as `"a","b"`, so parse strictly in the application as well. Don't move to the native JSON type without testing that key order survives | `CLOB`. 19c: plain `IS JSON` refuses scalars, so wrap the value: `CHECK (('[' \|\| value_json \|\| ']') IS JSON)` (test it on 19c). 21c and later: plain `value_json IS JSON` may accept scalars, depending on the `COMPATIBLE` setting; test it, and keep the 19c form if it does not. Don't use the native JSON type (binary; key order is not promised) |
| `boolean` | `boolean`, `TRUE` / `FALSE`; `a.shown` in conditions | `bit`, `1` / `0`; write `a.shown = 1` in conditions | `NUMBER(1) CHECK (shown IN (0, 1))`, and write `a.shown = 1` in conditions too (23ai has `BOOLEAN`) |
| `timestamp with time zone` | `timestamptz` (an instant, shown in the session's zone) | `datetimeoffset(3)`, `SYSDATETIMEOFFSET()`; or `datetime2` holding UTC | `TIMESTAMP WITH TIME ZONE`, `SYSTIMESTAMP` |
| Identity column (`answer_event.event_id`) | `bigint GENERATED ALWAYS AS IDENTITY` | `bigint IDENTITY(1,1)` | `NUMBER(19) GENERATED ALWAYS AS IDENTITY` |
| Text columns | `varchar(n)`; `text` for long text | `nvarchar(n)` (names and quotes carry accents: Itaú, Zürich); `nvarchar(max)` | `VARCHAR2(n CHAR)` in an AL32UTF8 database; `CLOB` |
| Empty strings | `''` is a value | `''` is a value | `''` is NULL. `flatten()` never writes an empty string, and the SID and name checks refuse empty values anyway |
| Regular-expression checks (SID, name, sha256) | `~` | No regex. SID: `sid COLLATE Latin1_General_BIN NOT LIKE '%[^A-Z0-9]%' AND LEN(sid) BETWEEN 1 AND 20`. Name: SQL Server ignores trailing spaces when it compares strings, so compare lengths; and `LTRIM`/`RTRIM` strip only spaces, so name the other blanks: `LEN(full_name) >= 1 AND DATALENGTH(full_name) = DATALENGTH(TRIM(NCHAR(9) + NCHAR(10) + NCHAR(13) + N' ' FROM full_name))` (`TRIM ... FROM`: 2017 and later; before that, refuse a space, tab, line feed or carriage return at either end with `LIKE` patterns) | `REGEXP_LIKE(sid, '^[A-Z0-9]{1,20}$', 'c')`; `REGEXP_LIKE(full_name, '^\S(.*\S)?$')` |
| One run per person (`ux_submission_respondent`) | `CREATE UNIQUE INDEX ux_submission_respondent ON submission (respondent_id) WHERE respondent_id IS NOT NULL` | The same filtered index (`WHERE respondent_id IS NOT NULL`); a plain unique constraint would allow only one NULL, that is one removed identity | `CREATE UNIQUE INDEX ux_submission_respondent ON submission (CASE WHEN respondent_id IS NOT NULL THEN respondent_id END)`. (A plain `UNIQUE (respondent_id)` also works in Oracle, which leaves all-NULL keys out of an index) |
| Locking a run in each save and at Send | `SELECT status, version FROM submission WHERE submission_id = :id FOR UPDATE` | `SELECT status, version FROM submission WITH (UPDLOCK, ROWLOCK) WHERE submission_id = :id` | `SELECT status, version FROM submission WHERE submission_id = :id FOR UPDATE` |
| Storing an answer (insert or update) | `INSERT ... ON CONFLICT (submission_id, step_id) DO UPDATE SET ..., shown = true`, with `GREATEST(answer.first_saved_at, EXCLUDED.saved_at)` | `MERGE ... WITH (HOLDLOCK)`, or `UPDATE` then `INSERT` when no row was updated (the run lock keeps it safe). `GREATEST` from 2022; on 2016 to 2019, `CASE WHEN target.first_saved_at > source.saved_at THEN target.first_saved_at ELSE source.saved_at END` | `MERGE`, with `GREATEST` |
| A new run always has a respondent (`tg_submission_new`) | `BEFORE INSERT` trigger refusing `respondent_id IS NULL OR identity_removed_at IS NOT NULL` (01) | `CREATE TRIGGER tg_submission_new ON submission AFTER INSERT AS IF EXISTS (SELECT 1 FROM inserted WHERE respondent_id IS NULL OR identity_removed_at IS NOT NULL) THROW 50001, 'A new run needs a respondent.', 1;` | `CREATE TRIGGER tg_submission_new BEFORE INSERT ON submission FOR EACH ROW WHEN (NEW.respondent_id IS NULL OR NEW.identity_removed_at IS NOT NULL) BEGIN RAISE_APPLICATION_ERROR(-20001, 'A new run needs a respondent.'); END;` |
| Rebuilding answer_item for submitted runs | `ALTER TABLE answer_item DISABLE TRIGGER tg_answer_item_submitted` and `ENABLE`, inside the rebuild's transaction (table owner) | `DISABLE TRIGGER tg_answer_item_submitted ON answer_item` and `ENABLE TRIGGER`, inside `BEGIN TRANSACTION ... COMMIT` (`ALTER` permission) | `ALTER TRIGGER tg_answer_item_submitted DISABLE` and `ENABLE` are DDL and commit on their own: commit only after the whole rebuild succeeds; on any error `ROLLBACK` first, then re-enable in a `finally` block, with writes stopped until it is enabled; or use an application-context bypass. See "Rebuilding answer_item" |
| Optional trigger (no writes to a submitted run) | PL/pgSQL function and three `BEFORE INSERT OR UPDATE` row triggers (end of 01) | An `AFTER INSERT, UPDATE` trigger per table that joins `inserted` to `submission` and `THROW`s when the run is submitted | A `BEFORE INSERT OR UPDATE ... FOR EACH ROW` trigger per table that reads `submission` and calls `RAISE_APPLICATION_ERROR` |
| `ON DELETE SET NULL` / `CASCADE` | yes | yes (one cascade path per table here, so no "multiple cascade paths" error) | yes |
| Comments on tables and columns | `COMMENT ON` | `sp_addextendedproperty 'MS_Description'` | `COMMENT ON` |
| Seed and sample literals (02, 03) | `DATE '2026-10-15'`, `'2026-10-19 08:30:00+00'`, `TRUE` | `'2026-10-15'`, `'2026-10-19 08:30:00 +00:00'`, `1` | `DATE '2026-10-15'`, `TIMESTAMP '2026-10-19 08:30:00 +00:00'`, `1`. Each INSERT is one row, as Oracle before 23ai needs |
| Script lines around the seed (02, 03, 05) | `SET client_encoding`, `BEGIN`, `COMMIT`; 05 also uses psql's `\pset` and PL/pgSQL | Drop the `SET`; `BEGIN TRANSACTION` ... `COMMIT`. 05 is PostgreSQL only | Drop the `SET` and the `BEGIN`; keep `COMMIT`. 05 is PostgreSQL only |
| Reading value_json in SQL | `json_each(value_json::json) WITH ORDINALITY` keeps document order | `OPENJSON(value_json)` (document order; key, value, type) | `JSON_TABLE` reads arrays and known keys; objects with variable keys are hard, which is why answer_item exists |
| Median | `percentile_cont(0.5) WITHIN GROUP (ORDER BY x)`, an aggregate | Only a window function, and `OVER (PARTITION BY ...)` does not mix with `GROUP BY`: compute it in a derived table, `SELECT g, PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY x) OVER (PARTITION BY g) AS med FROM ...`, then take `MAX(med)` in the grouped query | Same as PostgreSQL, or `MEDIAN(x)` |
| Reserved words | | No column is named `rule`, `condition`, `key`, `percent` or `sensitive` (the design's `condition` and `rule` are `show_condition` and `completion_rule` here; `sensitive` is `wave1_only`) | `version`, `label`, `seq` and `attribute` are not reserved |

`tools/build-sql.mjs` writes every literal through four helpers (`q`, `bool`, `ts` and `date`): change those to emit
another dialect's literals for 02 and 03.

## Decisions for the developer

1. **Whether a typed SID is trusted.** Anyone can type someone else's SID, and resuming by SID would then show that
   person's answers. If the survey sits behind J.P. Morgan single sign-on, take the SID from the session (show it, don't
   ask for it) or refuse a typed SID that differs from the session's. Decide also whether a different name typed on
   return replaces the stored one.
2. **Privacy approval and retention for storing names.** The design assumed pseudonymous storage (a code per link, names
   kept offline: design D26), and the privacy text on the welcome is still to come from J.P. Morgan privacy and HR.
   Storing SID and name needs their sign-off, a retention period, and a decision on who may read `respondent`.
3. **Where each respondent's market, region and wave come from.** The design cuts results by the market the person
   covers (from a roster, never shown) and runs a wave-2 version for market managers without the sensitive steps. This
   schema has no roster. Options: join `respondent.sid` to the J.P. Morgan directory at readout, or add a roster table
   keyed by SID. If both waves run, store the wave on the submission so `shows()` and `validate()` get `ctx.wave`.
4. **Whether to keep the shuffled order.** Most lists are shuffled per person, and 1.1-1.4 swap their two cards at
   random; the design logs each start order as `<store>.order` so order effects can be studied. Not stored here. If it
   is wanted, add a nullable `display_order_json` column to `answer`, or log it in `answer_event`.
5. **Whether to keep `answer_event`.** It is optional. Without it, the first committed value of an answer (which the
   design's chapter I rule and edit flags read) and every change of mind are lost; `answer` keeps only the latest value.
6. **When to write `answer_item`.** Recommended: in the same transaction as each save. A rebuild from
   `answer.value_json` also works, done as "Rebuilding answer_item" says: `flatten(step, value, { steps, answers })`
   with the run's other answers, rows with `shown = false` skipped, and, for submitted runs, the optional trigger
   switched off inside the rebuild's own transaction by a job with the table owner's rights.
7. **8.2a's fallback.** script.js lists a fallback question for 8.2a if "Comp 2.0" may not be named. It is not live. If
   it is used, release it as a new questionnaire version (its options become the step's `option` rows), or call
   `validate()` with `ctx.fallback = true`; its options are already in `step_option` as `fallback`.
8. **Changes to the script after launch.** A new script is a new `questionnaire` row and seed. One run per person,
   ever: a run keeps the version it started under, a returning respondent resumes it under that version even when a
   newer one exists, and only a person with no run starts under the newest. The design also allows additive changes
   after launch with resume "by key, not by version"; if that is wanted, decide whether new steps join the live version
   (and its sha256 changes) or start a new one.
9. **Partial answers.** This package accepts an incomplete but well-formed answer while a run is in progress and
   requires `complete` at Send. If you would rather store only committed (Next) values, keep drafts in the browser.
10. **The identity screen's wording.** It is not in script.js. A draft (heading, labels, errors, the returning lines,
    the privacy link) is in `data-spec/identity-screen.md` (also in the Word hand-over); it needs the same sign-off as the rest of
    the survey's copy.
11. **When to remove identities.** Only after fieldwork closes, recording the date in `identity_removed_at` (see
    "Remove it" under Identity), since a removed person could otherwise start a second run.
12. **Whether to keep the optional trigger.** The application refuses saves to a submitted run under the run lock; the
    trigger at the end of 01 refuses them in the database too. Keep it as a backstop, port it, or leave it out (05's
    trigger tests then go too).
