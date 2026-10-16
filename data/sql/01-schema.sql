-- =====================================================================================================================
-- Ceres: leadership survey for the J.P. Morgan International Private Bank. Storage schema.
--
-- Reference dialect: PostgreSQL 16. Columns use portable types only (varchar, integer, bigint, numeric, boolean,
-- date, timestamp with time zone, text for CLOB) plus uuid for the two surrogate keys. data-dictionary.md has the
-- notes for SQL Server and Oracle.
--
-- Three groups of tables:
--   the questionnaire   questionnaire, step, step_option      what was asked (loaded from script.js: 02-*.sql)
--   identity            respondent                            who answered; kept apart so it can be restricted or removed
--   answers             submission, answer, answer_item,      what they answered
--                       answer_event (optional)
--
-- Run in order: 01-schema.sql, 02-questionnaire-v3.sql, then answers (03-sample-respondent.sql is a sample).
-- The last section is an optional trigger that refuses answer writes to a submitted run (PostgreSQL; port or drop it).
-- =====================================================================================================================


-- ---------------------------------------------------------------------------------------------------------------------
-- The questionnaire
-- ---------------------------------------------------------------------------------------------------------------------

CREATE TABLE questionnaire (
  version        varchar(10)   NOT NULL,
  label          varchar(200)  NOT NULL,
  released       date          NOT NULL,
  script_sha256  char(64)      NOT NULL,
  CONSTRAINT pk_questionnaire PRIMARY KEY (version),
  CONSTRAINT ck_questionnaire_sha256 CHECK (script_sha256 ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE questionnaire IS 'One row per version of the survey script. Answers always point at the version they were given under; a new script (new wording, steps or options) is a new version, never an edit of an old one.';
COMMENT ON COLUMN questionnaire.version IS 'Version code, e.g. v3 (the third draft, after Adam''s and Chris''s notes of 15 Oct 2026).';
COMMENT ON COLUMN questionnaire.label IS 'Plain-words name of this version.';
COMMENT ON COLUMN questionnaire.released IS 'Date of this version of the script.';
COMMENT ON COLUMN questionnaire.script_sha256 IS 'SHA-256 (lower-case hex) of the script.js file this version was loaded from, so the seed can be matched to the exact file.';


CREATE TABLE step (
  version          varchar(10)    NOT NULL,
  step_id          varchar(20)    NOT NULL,
  seq              integer        NOT NULL,
  kind             varchar(20)    NOT NULL,
  template         varchar(20)    NOT NULL,
  chapter          varchar(5),
  parent_step_id   varchar(20),
  title            varchar(200)   NOT NULL,
  bridge           varchar(400),
  question         varchar(1000),
  instruction      varchar(400),
  notes            varchar(2000),
  show_condition   varchar(400),
  store            varchar(40),
  completion_rule  varchar(400),
  wave1_only       boolean        NOT NULL DEFAULT false,
  CONSTRAINT pk_step PRIMARY KEY (version, step_id),
  CONSTRAINT uq_step_seq UNIQUE (version, seq),
  CONSTRAINT fk_step_questionnaire FOREIGN KEY (version) REFERENCES questionnaire (version),
  CONSTRAINT fk_step_parent FOREIGN KEY (version, parent_step_id) REFERENCES step (version, step_id),
  CONSTRAINT ck_step_seq CHECK (seq >= 1),
  CONSTRAINT ck_step_kind CHECK (kind IN ('welcome', 'statement', 'break', 'question', 'followup', 'pause', 'ending')),
  CONSTRAINT ck_step_template CHECK (template IN ('flow', 'break', 'checklist', 'text', 'piles', 'podium', 'configure',
    'track', 'trays', 'ladder', 'rank', 'sentence', 'stamp', 'allocate-ledger', 'allocate-list', 'bottle', 'newspaper')),
  CONSTRAINT ck_step_parent CHECK ((kind = 'followup') = (parent_step_id IS NOT NULL))
);

COMMENT ON TABLE step IS 'Every screen of a questionnaire version, in play order: questions, follow-ups, chapter breaks, the welcome, the opening statement, the pause card and the ending. v3 has 77.';
COMMENT ON COLUMN step.version IS 'Questionnaire version (questionnaire.version).';
COMMENT ON COLUMN step.step_id IS 'Step id from script.js: 1.1, 2.2, 2.2a (a follow-up of 2.2), break-II, W (welcome), 0.1 (opening statement), pause, end.';
COMMENT ON COLUMN step.seq IS 'Play order, 1 = the first screen after the identity screen (W, the welcome).';
COMMENT ON COLUMN step.kind IS 'welcome, statement (0.1), break (chapter break), question, followup, pause or ending.';
COMMENT ON COLUMN step.template IS 'The screen type, which fixes the shape of the saved answer: checklist, text, piles, podium, configure, track, trays, ladder, rank, sentence, stamp, allocate-ledger, allocate-list, bottle, newspaper; flow and break save nothing.';
COMMENT ON COLUMN step.chapter IS 'Chapter numeral, I to X; NULL for the welcome, 0.1 and the ending.';
COMMENT ON COLUMN step.parent_step_id IS 'For a follow-up, the question it follows (2.2a follows 2.2); NULL otherwise.';
COMMENT ON COLUMN step.title IS 'Short title of the step, from the design''s play order.';
COMMENT ON COLUMN step.bridge IS 'The line shown above the question that leads into it, as written; NULL if none.';
COMMENT ON COLUMN step.question IS 'The question as written in script.js. Placeholders are kept: [X] and [N] are filled from earlier answers ($[X]mm on 4.1a and 5.2, [N] on 5.4a), {n} is a count filled when the screen loads, and [    ] or ________ marks the blank the respondent fills.';
COMMENT ON COLUMN step.instruction IS 'The instruction under the question, as written; NULL if none.';
COMMENT ON COLUMN step.notes IS 'Grey notes under the instruction, one per line; NULL if none. (The context line "HNW client: $5-20mm liquid net worth" is added by the screen to every question and is not stored here.)';
COMMENT ON COLUMN step.show_condition IS 'When a conditional step shows, in plain words (script.js previewCondition); NULL if it always shows. v3 has 11: 2.2a, 2.4, 2.4a, 2.5a, 4.3a, 5.4a, 6.2a, 6.3a, 7.2a, 8.1a, 8.4a.';
COMMENT ON COLUMN step.store IS 'The design''s store name for the answer (script.js data.store), e.g. products for 2.2; NULL for steps that save nothing.';
COMMENT ON COLUMN step.completion_rule IS 'What the respondent must do before Next moves on, in plain words (script.js rule).';
COMMENT ON COLUMN step.wave1_only IS 'TRUE for a sensitive step (script.js sensitive): asked in wave 1 (senior leaders) only, dropped for the wave-2 market managers. v3: 4.4, 8.2, 8.2a, 8.3, 8.4, 8.4a, 8.4b.';


CREATE TABLE step_option (
  version           varchar(10)    NOT NULL,
  step_id           varchar(20)    NOT NULL,
  option_set        varchar(20)    NOT NULL,
  option_id         varchar(60)    NOT NULL,
  label             varchar(400),
  hint              varchar(400),
  grp               varchar(100),
  parent_option_id  varchar(60),
  seq               integer        NOT NULL,
  extra_json        text,
  CONSTRAINT pk_step_option PRIMARY KEY (version, step_id, option_set, option_id),
  CONSTRAINT fk_step_option_step FOREIGN KEY (version, step_id) REFERENCES step (version, step_id) ON DELETE CASCADE,
  CONSTRAINT ck_step_option_set CHECK (option_set IN ('option', 'fallback', 'region', 'market', 'other', 'field', 'chip',
    'suggestion', 'card', 'pile', 'item', 'part', 'part_option', 'stop', 'end', 'tray', 'tile', 'row', 'column', 'block',
    'slot', 'opt_out', 'role', 'stamp', 'jug')),
  CONSTRAINT ck_step_option_seq CHECK (seq >= 1),
  CONSTRAINT ck_step_option_extra CHECK (extra_json IS JSON OBJECT)
);

COMMENT ON TABLE step_option IS 'Every choice a step offers, and the other named parts of a step that answers point to (fields, slots, rows, roles). Top-3 follow-ups (2.2a, 2.5a, 6.3a, 7.2a) and 8.1a have no rows here: they offer their parent''s cards, so their answers point at the parent''s card rows.';
COMMENT ON COLUMN step_option.version IS 'Questionnaire version.';
COMMENT ON COLUMN step_option.step_id IS 'The step that offers the option.';
COMMENT ON COLUMN step_option.option_set IS 'What kind of thing the option is (card, pile, option, stop, field, row ...). data-dictionary.md lists the vocabulary. option_id is unique within a step and set.';
COMMENT ON COLUMN step_option.option_id IS 'The id as saved in answers and in answer_item.item_id or value_text (script.js id). For 9.4b markets it is the market name itself, and for 10.3''s chip and suggestions the text they put in the field.';
COMMENT ON COLUMN step_option.label IS 'Label shown to the respondent, as written. For fields, the stem above the box; for sentence slots, the sentence with each slot in brackets.';
COMMENT ON COLUMN step_option.hint IS 'Smaller line under the label (a pile''s gloss; a 2.3 part''s question); NULL if none.';
COMMENT ON COLUMN step_option.grp IS 'Group printed above the label: the four card groups of 2.5 (The relationship, Specialist resources, Planning and reporting, Family and life events); NULL elsewhere.';
COMMENT ON COLUMN step_option.parent_option_id IS 'The option of the same step this one sits under: a 2.3 part option''s part (belongs, covers, who), a 9.4b market''s region, a word chip''s slot (4.2: verb), 10.3''s chip and suggestions'' field (name). NULL otherwise.';
COMMENT ON COLUMN step_option.seq IS 'Order as written in script.js, from 1, within the step, set and parent_option_id. The screen may shuffle it; a track''s stops and a podium''s ranks keep it.';
COMMENT ON COLUMN step_option.extra_json IS 'Other properties of the option from script.js, as a JSON object (NULL if none), e.g. {"only":["execute"]} on 2.3''s who options, {"always":true} on 2.6''s business-banking tile, {"role":true} on 4.3''s role cards, {"sensitive":true} on 8.1''s price-list card (dropped in wave 2), the number range of a slot or role, a text field''s limit.';


-- ---------------------------------------------------------------------------------------------------------------------
-- Identity: kept in its own table, so it can be restricted (grant it to few) or removed without touching answers.
-- ---------------------------------------------------------------------------------------------------------------------

CREATE TABLE respondent (
  respondent_id  uuid           NOT NULL DEFAULT gen_random_uuid(),
  sid            varchar(20)    NOT NULL,
  full_name      varchar(200)   NOT NULL,
  created_at     timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_respondent PRIMARY KEY (respondent_id),
  CONSTRAINT uq_respondent_sid UNIQUE (sid),
  CONSTRAINT ck_respondent_sid CHECK (sid ~ '^[A-Z0-9]{1,20}$'),
  CONSTRAINT ck_respondent_full_name CHECK (char_length(full_name) BETWEEN 1 AND 200 AND full_name !~ '^\s' AND full_name !~ '\s$')
);

COMMENT ON TABLE respondent IS 'Who answered: one row per person, typed on the identity screen before the welcome. Answers reach this table only through submission.respondent_id. Deleting a row removes the identity and leaves the answers (submission.respondent_id becomes NULL).';
COMMENT ON COLUMN respondent.respondent_id IS 'Surrogate key: a random UUID (gen_random_uuid() or the like), never derived from the SID or the name, so it reveals nothing once the identity is removed. The only link from answers to identity.';
COMMENT ON COLUMN respondent.sid IS 'J.P. Morgan Standard ID as typed, stored trimmed and upper-cased. Usually one letter and six digits (R123456, pattern ^[A-Z][0-9]{6}$); any 1 to 20 letters and digits are accepted, so an unusual SID is kept and can be checked by hand. Unique.';
COMMENT ON COLUMN respondent.full_name IS 'Full name as typed, trimmed of leading and trailing spaces, 1 to 200 characters; case and spelling as entered.';
COMMENT ON COLUMN respondent.created_at IS 'When the identity screen was first submitted.';


-- ---------------------------------------------------------------------------------------------------------------------
-- Answers
-- ---------------------------------------------------------------------------------------------------------------------

CREATE TABLE submission (
  submission_id  uuid           NOT NULL DEFAULT gen_random_uuid(),
  respondent_id  uuid,
  version        varchar(10)    NOT NULL,
  status         varchar(12)    NOT NULL DEFAULT 'in_progress',
  started_at     timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_saved_at  timestamp with time zone,
  submitted_at   timestamp with time zone,
  last_step_id   varchar(20),
  device         varchar(10),
  identity_removed_at timestamp with time zone,
  CONSTRAINT pk_submission PRIMARY KEY (submission_id),
  CONSTRAINT uq_submission_id_version UNIQUE (submission_id, version),
  CONSTRAINT fk_submission_respondent FOREIGN KEY (respondent_id) REFERENCES respondent (respondent_id) ON DELETE SET NULL,
  CONSTRAINT fk_submission_questionnaire FOREIGN KEY (version) REFERENCES questionnaire (version),
  CONSTRAINT fk_submission_last_step FOREIGN KEY (version, last_step_id) REFERENCES step (version, step_id),
  CONSTRAINT ck_submission_status CHECK (status IN ('in_progress', 'submitted')),
  CONSTRAINT ck_submission_submitted CHECK ((status = 'submitted') = (submitted_at IS NOT NULL)),
  CONSTRAINT ck_submission_times CHECK (submitted_at IS NULL OR submitted_at >= started_at),
  CONSTRAINT ck_submission_device CHECK (device IN ('laptop', 'phone', 'tablet')),
  CONSTRAINT ck_submission_identity CHECK (respondent_id IS NOT NULL OR identity_removed_at IS NOT NULL)
);

-- One run per person, ever: whatever the version, a returning respondent resumes their own run.
-- (Partial index: runs whose identity was removed have no respondent_id and are not compared.)
CREATE UNIQUE INDEX ux_submission_respondent ON submission (respondent_id) WHERE respondent_id IS NOT NULL;

-- A new run always belongs to a respondent. ck_submission_identity alone would let a run be inserted with no
-- respondent and identity_removed_at already set; identity_removed_at is only for a run whose identity is removed later.
CREATE FUNCTION check_new_submission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.respondent_id IS NULL OR NEW.identity_removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'a new run needs a respondent, and no identity_removed_at'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tg_submission_new BEFORE INSERT ON submission
  FOR EACH ROW EXECUTE FUNCTION check_new_submission();

COMMENT ON FUNCTION check_new_submission() IS 'Refuses a new run (insert) without a respondent, or with identity_removed_at already set. Removing an identity later is an update, which ck_submission_identity governs.';

COMMENT ON TABLE submission IS 'One run through the survey by one respondent. One run per person, ever (ux_submission_respondent): a returning respondent resumes their run under the version it started with, or is thanked if it is submitted; a run is created, under the current version, only when they have none.';
COMMENT ON COLUMN submission.submission_id IS 'Surrogate key: a random UUID (gen_random_uuid() or the like), never derived from the SID or the name.';
COMMENT ON COLUMN submission.respondent_id IS 'Who (respondent.respondent_id). NULL only after the respondent''s identity was removed, and then identity_removed_at says when (ck_submission_identity).';
COMMENT ON COLUMN submission.version IS 'The questionnaire version the run started under; it keeps it to the end.';
COMMENT ON COLUMN submission.status IS 'in_progress until Send on the last question (10.5), then submitted. Analyses normally read submitted only.';
COMMENT ON COLUMN submission.started_at IS 'When the submission was created (the identity screen was passed).';
COMMENT ON COLUMN submission.last_saved_at IS 'When any answer was last saved; for reminders and for spotting abandoned runs.';
COMMENT ON COLUMN submission.submitted_at IS 'When Send was pressed on 10.5; NULL while in progress.';
COMMENT ON COLUMN submission.last_step_id IS 'The step the respondent was last on, where a resume reopens (a follow-up reopens its parent first).';
COMMENT ON COLUMN submission.device IS 'laptop, phone or tablet, as last seen (the survey lays out for laptop from 1280x650 up, for phone below); NULL if unknown.';
COMMENT ON COLUMN submission.identity_removed_at IS 'When the respondent''s identity was removed; NULL while it is kept, and always NULL on a new run (tg_submission_new). Set it before deleting the respondent row: the delete sets respondent_id to NULL, which ck_submission_identity allows only once this is set.';


CREATE TABLE answer (
  submission_id   uuid           NOT NULL,
  version         varchar(10)    NOT NULL,
  step_id         varchar(20)    NOT NULL,
  value_json      text,
  shown           boolean        NOT NULL DEFAULT true,
  first_saved_at  timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  saved_at        timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revision        integer        NOT NULL DEFAULT 1,
  CONSTRAINT pk_answer PRIMARY KEY (submission_id, step_id),
  CONSTRAINT fk_answer_submission FOREIGN KEY (submission_id, version) REFERENCES submission (submission_id, version) ON DELETE CASCADE,
  CONSTRAINT fk_answer_step FOREIGN KEY (version, step_id) REFERENCES step (version, step_id),
  CONSTRAINT ck_answer_value_json CHECK (value_json IS JSON),
  CONSTRAINT ck_answer_shown CHECK (shown OR value_json IS NULL),
  CONSTRAINT ck_answer_revision CHECK (revision >= 1),
  CONSTRAINT ck_answer_times CHECK (saved_at >= first_saved_at)
);

COMMENT ON TABLE answer IS 'One row per step answered (and per step passed without showing: see shown), holding the answer exactly as the screen saved it. The source of truth; answer_item is derived from it.';
COMMENT ON COLUMN answer.submission_id IS 'The submission (submission.submission_id).';
COMMENT ON COLUMN answer.version IS 'Same as submission.version; carried here so step_id can reference step.';
COMMENT ON COLUMN answer.step_id IS 'The step answered. Steps that save nothing (welcome, 0.1, breaks, pause, end) have no rows.';
COMMENT ON COLUMN answer.value_json IS 'The answer exactly as the screen saved it, as JSON text: a string, a number, a list or an object, per the step''s template (data-dictionary.md). A bare string ("goals" on 1.1) or number (60 on 7.1) is a valid answer, so the JSON check must accept scalars. Stored as text so the key order survives: a card sort''s keys are in placement order. Do not convert to jsonb, which sorts keys. NULL when the step was not shown, or shown and left empty (10.4 is optional; 5.2 has nothing to place when 5.1''s split is $10mm).';
COMMENT ON COLUMN answer.shown IS 'FALSE for a step the respondent passed without seeing it: a conditional step that did not fire (e.g. 2.2a when Critical holds 3 cards or fewer), or a wave-1-only step in wave 2. Written when they pass it; value_json is then NULL. TRUE otherwise.';
COMMENT ON COLUMN answer.first_saved_at IS 'When this row was first written.';
COMMENT ON COLUMN answer.saved_at IS 'When this row was last written.';
COMMENT ON COLUMN answer.revision IS 'How many times this row has been written, from 1. Matches the latest answer_event.revision when events are kept.';


CREATE TABLE answer_item (
  submission_id  uuid            NOT NULL,
  step_id        varchar(20)     NOT NULL,
  item_id        varchar(60)     NOT NULL,
  attribute      varchar(20)     NOT NULL,
  value_text     varchar(4000),
  value_number   numeric(14,4),
  seq            integer         NOT NULL,
  CONSTRAINT pk_answer_item PRIMARY KEY (submission_id, step_id, item_id, attribute, seq),
  CONSTRAINT fk_answer_item_answer FOREIGN KEY (submission_id, step_id) REFERENCES answer (submission_id, step_id) ON DELETE CASCADE,
  CONSTRAINT ck_answer_item_attribute CHECK (attribute IN ('choice', 'region', 'market', 'text', 'pile', 'rank',
    'belongs', 'covers', 'who', 'stop', 'percent', 'tray', 'amount_mm', 'number', 'chip', 'opt_out', 'stamp', 'count')),
  CONSTRAINT ck_answer_item_seq CHECK (seq >= 1)
);

COMMENT ON TABLE answer_item IS 'The answers in long format, one row per atomic element, for analysis in any SQL engine. Derived from answer.value_json by flatten() in tools/flatten.mjs (mapping in data-dictionary.md); rewrite a step''s rows whenever its answer changes, in the same transaction.';
COMMENT ON COLUMN answer_item.submission_id IS 'The submission.';
COMMENT ON COLUMN answer_item.step_id IS 'The step answered.';
COMMENT ON COLUMN answer_item.item_id IS 'What the row is about: a card, option, stop, field, row, role, slot, tile, block, jug, or a 2.3 way of investing. A step_option of the step (or, for 2.2a, 2.5a, 6.3a, 7.2a and 8.1a, of the parent).';
COMMENT ON COLUMN answer_item.attribute IS 'What the value is: choice, region, market, text, pile, rank, belongs, covers, who, stop, percent, tray, amount_mm, number, chip, opt_out, stamp or count.';
COMMENT ON COLUMN answer_item.value_text IS 'Text value: the pile, stamp, tray, word chip or 2.3 option chosen for the item, the typed text (trimmed; 10.5 cleaned as its page cleans it), or the 9.4b market. On 10.3''s chip row, the chip''s text (no one). NULL when the value is a number or the item itself is the choice.';
COMMENT ON COLUMN answer_item.value_number IS 'Number value: a rank (1 = first), a per cent, an amount in $mm, a count, a typed number, or a stop''s position on its scale (1 = first stop).';
COMMENT ON COLUMN answer_item.seq IS 'Position, from 1: the order cards were placed (card sorts); the order saved for trays and stamp decks (a revisit may rewrite it); the rank (podium, rank); the order picked (pick one or two); the position in 2.3''s covers list; for other records the order of value_json''s keys; 1 for a single value.';


-- Optional: keep it if changes of mind (Undo, re-sorting, edits) are to be studied; the survey works without it.
CREATE TABLE answer_event (
  event_id       bigint         GENERATED ALWAYS AS IDENTITY,
  submission_id  uuid           NOT NULL,
  step_id        varchar(20)    NOT NULL,
  revision       integer        NOT NULL,
  value_json     text,
  committed      boolean        NOT NULL DEFAULT false,
  saved_at       timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_answer_event PRIMARY KEY (event_id),
  CONSTRAINT uq_answer_event_revision UNIQUE (submission_id, step_id, revision),
  CONSTRAINT fk_answer_event_answer FOREIGN KEY (submission_id, step_id) REFERENCES answer (submission_id, step_id) ON DELETE CASCADE,
  CONSTRAINT ck_answer_event_value_json CHECK (value_json IS JSON),
  CONSTRAINT ck_answer_event_revision CHECK (revision >= 1)
);

COMMENT ON TABLE answer_event IS 'OPTIONAL. Append-only log of every save of every answer: never updated or deleted (except with its submission). Lets analysts study changes of mind, e.g. a card sorted, undone and sorted again.';
COMMENT ON COLUMN answer_event.event_id IS 'Surrogate key, increasing in the order saves arrive.';
COMMENT ON COLUMN answer_event.submission_id IS 'The submission.';
COMMENT ON COLUMN answer_event.step_id IS 'The step.';
COMMENT ON COLUMN answer_event.revision IS 'answer.revision after this save.';
COMMENT ON COLUMN answer_event.value_json IS 'The answer as saved by this save (same format as answer.value_json); NULL if the save cleared it.';
COMMENT ON COLUMN answer_event.committed IS 'TRUE when Next left the screen (a commit); FALSE for an autosave while the respondent was still on it (a draft).';
COMMENT ON COLUMN answer_event.saved_at IS 'When the save reached the server.';


-- ---------------------------------------------------------------------------------------------------------------------
-- Indexes for the usual reads (the keys above already index the primary and unique columns)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE INDEX ix_submission_version_status ON submission (version, status);
CREATE INDEX ix_answer_step ON answer (version, step_id);
CREATE INDEX ix_answer_item_step ON answer_item (step_id, attribute, item_id);
CREATE INDEX ix_answer_event_submission ON answer_event (submission_id, step_id, revision);


-- ---------------------------------------------------------------------------------------------------------------------
-- OPTIONAL: a submitted run cannot change. The application refuses such saves first (it locks the submission row and
-- checks its status in every save transaction); this trigger is the database's backstop. It refuses inserts and
-- updates of answer, answer_item and answer_event rows whose run is submitted; deletes (erasing a run) still work.
-- To rebuild answer_item for submitted runs, see "Rebuilding answer_item" in data-dictionary.md.
-- PostgreSQL syntax: write the same trigger in T-SQL or PL/SQL, or leave it out.
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION refuse_write_to_submitted_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM submission WHERE submission_id = NEW.submission_id AND status = 'submitted') THEN
    RAISE EXCEPTION 'submission % is submitted: its answers cannot change', NEW.submission_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tg_answer_submitted BEFORE INSERT OR UPDATE ON answer
  FOR EACH ROW EXECUTE FUNCTION refuse_write_to_submitted_run();
CREATE TRIGGER tg_answer_item_submitted BEFORE INSERT OR UPDATE ON answer_item
  FOR EACH ROW EXECUTE FUNCTION refuse_write_to_submitted_run();
CREATE TRIGGER tg_answer_event_submitted BEFORE INSERT OR UPDATE ON answer_event
  FOR EACH ROW EXECUTE FUNCTION refuse_write_to_submitted_run();

COMMENT ON FUNCTION refuse_write_to_submitted_run() IS 'OPTIONAL. Refuses inserts and updates of answer rows whose run is submitted (used by the tg_*_submitted triggers). A rebuild of answer_item for submitted runs disables tg_answer_item_submitted inside its own transaction (data-dictionary.md, "Rebuilding answer_item").';


-- ---------------------------------------------------------------------------------------------------------------------
-- Access (example): analysts read answers without identity; only a few people read respondent.
-- ---------------------------------------------------------------------------------------------------------------------
-- CREATE ROLE ceres_analyst;
-- GRANT SELECT ON questionnaire, step, step_option, submission, answer, answer_item, answer_event TO ceres_analyst;
-- (no grant on respondent)
