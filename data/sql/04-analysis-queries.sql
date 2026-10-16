-- =====================================================================================================================
-- Ceres questionnaire v3: ready analysis queries.
--
-- Every query reads submitted runs of v3 only (s.status = 'submitted'); drop that condition to include runs still in
-- progress. Every query that reads answers joins answer and keeps a.shown only: a step that did not show has no value
-- and no answer_item rows, and the filter keeps it that way even if a row was left behind by mistake. Labels come
-- from step_option.
--
-- The SQL is standard apart from:
--   boolean columns used as conditions (a.shown): on SQL Server, and on Oracle before 23ai, write a.shown = 1;
--   percentile_cont ... WITHIN GROUP: an aggregate in PostgreSQL and Oracle; on SQL Server it is only a window
--     function, and OVER (PARTITION BY ...) does not mix with GROUP BY, so compute the median in a derived table
--     (one row per value, with the window median beside it) and take MAX() of it in the grouped query;
--   the regular expression in Q14; and || for joining strings in Q12 (SQL Server: + or CONCAT).
--
-- Each query starts with a "-- [Qn]" line. 05-checks.sql runs every one, expects rows, and checks some values.
-- One statement per block.
-- =====================================================================================================================


-- [Q1] Card sorts (2.2 products, 2.5 services, 6.3 banker qualities, 7.2 digital features): how many respondents put
--      each card in each pile, and what share of the respondents who sorted the card that is. Every card and pile is
--      listed, so empty cells show as 0.
WITH sorted AS (
  SELECT ai.step_id, ai.item_id AS card_id, ai.value_text AS pile_id
  FROM answer_item ai
  JOIN answer a ON a.submission_id = ai.submission_id AND a.step_id = ai.step_id AND a.shown
  JOIN submission s ON s.submission_id = a.submission_id
  WHERE s.version = 'v3' AND s.status = 'submitted'
    AND ai.step_id IN ('2.2', '2.5', '6.3', '7.2') AND ai.attribute = 'pile'
),
grid AS (
  SELECT st.seq AS step_seq, c.step_id, c.option_id AS card_id, c.label AS card, c.grp AS card_group, c.seq AS card_seq,
         p.option_id AS pile_id, p.label AS pile, p.seq AS pile_seq
  FROM step_option c
  JOIN step_option p ON p.version = c.version AND p.step_id = c.step_id AND p.option_set = 'pile'
  JOIN step st ON st.version = c.version AND st.step_id = c.step_id
  WHERE c.version = 'v3' AND c.option_set = 'card' AND c.step_id IN ('2.2', '2.5', '6.3', '7.2')
)
SELECT g.step_id, g.card_group, g.card, g.pile,
       COUNT(x.card_id) AS respondents,
       ROUND(100.0 * COUNT(x.card_id) / NULLIF(SUM(COUNT(x.card_id)) OVER (PARTITION BY g.step_id, g.card_id), 0), 1) AS pct_of_card
FROM grid g
LEFT JOIN sorted x ON x.step_id = g.step_id AND x.card_id = g.card_id AND x.pile_id = g.pile_id
GROUP BY g.step_seq, g.step_id, g.card_seq, g.card_id, g.card_group, g.card, g.pile_seq, g.pile
ORDER BY g.step_seq, g.card_seq, g.pile_seq;


-- [Q2] Top 3 picks (2.2a, 2.5a, 6.3a, 7.2a pick from the parent's Critical pile; 3.2 from its own ten): how often each
--      card was placed 1st, 2nd and 3rd, and its points (3 for 1st, 2 for 2nd, 1 for 3rd). A follow-up's card labels
--      come from its parent's cards. Respondents who did not see a top-3 question are not counted here: see Q3.
SELECT ai.step_id, o.label AS card,
       SUM(CASE WHEN ai.value_number = 1 THEN 1 ELSE 0 END) AS n_first,
       SUM(CASE WHEN ai.value_number = 2 THEN 1 ELSE 0 END) AS n_second,
       SUM(CASE WHEN ai.value_number = 3 THEN 1 ELSE 0 END) AS n_third,
       COUNT(*) AS in_top3,
       CAST(SUM(4 - ai.value_number) AS integer) AS points
FROM answer_item ai
JOIN answer a ON a.submission_id = ai.submission_id AND a.step_id = ai.step_id AND a.shown
JOIN submission s ON s.submission_id = a.submission_id
JOIN step st ON st.version = s.version AND st.step_id = ai.step_id
JOIN step_option o ON o.version = st.version AND o.step_id = COALESCE(st.parent_step_id, st.step_id)
                  AND o.option_set IN ('card', 'option') AND o.option_id = ai.item_id
WHERE s.version = 'v3' AND s.status = 'submitted'
  AND ai.step_id IN ('2.2a', '2.5a', '6.3a', '7.2a', '3.2') AND ai.attribute = 'rank'
GROUP BY st.seq, ai.step_id, o.label
ORDER BY st.seq, points DESC, o.label;


-- [Q3] Top 3, counting everyone. A respondent whose Critical pile held three cards or fewer did not see the top-3
--      question (its answer row has shown = false): their Critical cards are their top 3, unranked. Per card, the
--      respondents who have it in their top 3 either way.
WITH followup AS (
  SELECT st.step_id, st.parent_step_id
  FROM step st
  WHERE st.version = 'v3' AND st.template = 'podium' AND st.parent_step_id IS NOT NULL
),
top3 AS (
  SELECT f.parent_step_id, ai.submission_id, ai.item_id, 'picked' AS how
  FROM followup f
  JOIN answer a ON a.step_id = f.step_id AND a.shown
  JOIN answer_item ai ON ai.submission_id = a.submission_id AND ai.step_id = a.step_id AND ai.attribute = 'rank'
  UNION ALL
  SELECT f.parent_step_id, ai.submission_id, ai.item_id, 'implied' AS how
  FROM followup f
  JOIN answer a ON a.step_id = f.step_id AND NOT a.shown
  JOIN answer p ON p.submission_id = a.submission_id AND p.step_id = f.parent_step_id AND p.shown
  JOIN answer_item ai ON ai.submission_id = p.submission_id AND ai.step_id = p.step_id
                     AND ai.attribute = 'pile' AND ai.value_text = 'critical'
)
SELECT t.parent_step_id AS step_id, o.label AS card,
       COUNT(*) AS in_top3,
       SUM(CASE WHEN t.how = 'picked' THEN 1 ELSE 0 END) AS picked_on_podium,
       SUM(CASE WHEN t.how = 'implied' THEN 1 ELSE 0 END) AS critical_without_podium
FROM top3 t
JOIN submission s ON s.submission_id = t.submission_id
JOIN step_option o ON o.version = s.version AND o.step_id = t.parent_step_id AND o.option_set = 'card' AND o.option_id = t.item_id
WHERE s.version = 'v3' AND s.status = 'submitted'
GROUP BY t.parent_step_id, o.label
ORDER BY t.parent_step_id, in_top3 DESC, o.label;


-- [Q4] 2.4 How much customisation (five stops, 1 = a standard portfolio, 5 = fully bespoke) and 2.4a How many standard
--      risk profiles: respondents per answer, in the order the screen lists them (only those who saw the question).
WITH picks AS (
  SELECT ai.step_id, ai.item_id
  FROM answer_item ai
  JOIN answer a ON a.submission_id = ai.submission_id AND a.step_id = ai.step_id AND a.shown
  JOIN submission s ON s.submission_id = a.submission_id
  WHERE s.version = 'v3' AND s.status = 'submitted' AND ai.step_id IN ('2.4', '2.4a')
)
SELECT o.step_id, o.seq AS position, o.label, o.hint,
       COUNT(p.item_id) AS respondents,
       ROUND(100.0 * COUNT(p.item_id) / NULLIF(SUM(COUNT(p.item_id)) OVER (PARTITION BY o.step_id), 0), 1) AS pct
FROM step_option o
LEFT JOIN picks p ON p.step_id = o.step_id AND p.item_id = o.option_id
WHERE o.version = 'v3'
  AND ((o.step_id = '2.4' AND o.option_set = 'stop') OR (o.step_id = '2.4a' AND o.option_set = 'option'))
GROUP BY o.step_id, o.seq, o.label, o.hint
ORDER BY o.step_id, o.seq;


-- [Q5] 2.4 in one line: how many saw it (it shows only if Engage or Entrust is offered on 2.3), how many passed it
--      without seeing it, and the mean and median position on the scale (1 = most standard, 5 = most tailored).
SELECT SUM(CASE WHEN a.shown THEN 1 ELSE 0 END) AS saw_2_4,
       SUM(CASE WHEN a.shown THEN 0 ELSE 1 END) AS did_not_see_2_4,
       ROUND(AVG(ai.value_number), 2) AS mean_position,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY ai.value_number) AS median_position
FROM answer a
JOIN submission s ON s.submission_id = a.submission_id
LEFT JOIN answer_item ai ON ai.submission_id = a.submission_id AND ai.step_id = a.step_id AND ai.attribute = 'stop' AND a.shown
WHERE s.version = 'v3' AND s.status = 'submitted' AND a.step_id = '2.4';


-- [Q6] 2.1 What drew clients to J.P. Morgan: each respondent's three answers, one row per respondent. To show who wrote
--      them (only for people allowed to read identity), add: LEFT JOIN respondent r ON r.respondent_id = s.respondent_id
SELECT s.submission_id, s.submitted_at,
       MAX(CASE WHEN ai.item_id = 'r1' THEN ai.value_text END) AS reason_1,
       MAX(CASE WHEN ai.item_id = 'r2' THEN ai.value_text END) AS reason_2,
       MAX(CASE WHEN ai.item_id = 'r3' THEN ai.value_text END) AS reason_3
FROM answer_item ai
JOIN answer a ON a.submission_id = ai.submission_id AND a.step_id = ai.step_id AND a.shown
JOIN submission s ON s.submission_id = a.submission_id
WHERE s.version = 'v3' AND s.status = 'submitted' AND ai.step_id = '2.1' AND ai.attribute = 'text'
GROUP BY s.submission_id, s.submitted_at
ORDER BY s.submitted_at;


-- [Q7] 4.3 and 4.3a, per role: how many stamped it Every HNW client, Only above an amount or No HNW client; and for
--      Only above an amount, the amounts given on 4.3a ($mm of liquid net worth): lowest, median, mean, highest.
WITH stamped AS (
  SELECT ai.item_id AS role_id,
         SUM(CASE WHEN ai.value_text = 'every' THEN 1 ELSE 0 END) AS every_client,
         SUM(CASE WHEN ai.value_text = 'above' THEN 1 ELSE 0 END) AS above_an_amount,
         SUM(CASE WHEN ai.value_text = 'none' THEN 1 ELSE 0 END) AS no_client
  FROM answer_item ai
  JOIN answer a ON a.submission_id = ai.submission_id AND a.step_id = ai.step_id AND a.shown
  JOIN submission s ON s.submission_id = a.submission_id
  WHERE s.version = 'v3' AND s.status = 'submitted' AND ai.step_id = '4.3' AND ai.attribute = 'stamp'
  GROUP BY ai.item_id
),
amounts AS (
  SELECT ai.item_id AS role_id, COUNT(*) AS n, CAST(MIN(ai.value_number) AS numeric(8,1)) AS lowest_mm,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY ai.value_number) AS median_mm,
         ROUND(AVG(ai.value_number), 2) AS mean_mm, CAST(MAX(ai.value_number) AS numeric(8,1)) AS highest_mm
  FROM answer_item ai
  JOIN answer a ON a.submission_id = ai.submission_id AND a.step_id = ai.step_id AND a.shown
  JOIN submission s ON s.submission_id = a.submission_id
  WHERE s.version = 'v3' AND s.status = 'submitted' AND ai.step_id = '4.3a' AND ai.attribute = 'amount_mm'
  GROUP BY ai.item_id
)
SELECT r.label AS role,
       COALESCE(st.every_client, 0) AS every_client, COALESCE(st.above_an_amount, 0) AS above_an_amount,
       COALESCE(st.no_client, 0) AS no_client, COALESCE(am.n, 0) AS amounts_given,
       am.lowest_mm, am.median_mm, am.mean_mm, am.highest_mm
FROM step_option r
LEFT JOIN stamped st ON st.role_id = r.option_id
LEFT JOIN amounts am ON am.role_id = r.option_id
WHERE r.version = 'v3' AND r.step_id = '4.3a' AND r.option_set = 'role'
ORDER BY r.seq;


-- [Q8] 5.4a Where the clients of 5.4 come from: the mean share of each source over the respondents who answered 5.4a
--      (a source left blank counts as 0%, so the means add up to 100), and the mean number of clients that share
--      stands for (the share times the respondent's own 5.4 number).
WITH answered AS (
  SELECT a.submission_id
  FROM answer a
  JOIN submission s ON s.submission_id = a.submission_id
  WHERE s.version = 'v3' AND s.status = 'submitted' AND a.step_id = '5.4a' AND a.shown AND a.value_json IS NOT NULL
),
clients AS (
  SELECT ai.submission_id, ai.value_number AS n
  FROM answer_item ai
  JOIN answer a ON a.submission_id = ai.submission_id AND a.step_id = ai.step_id AND a.shown
  JOIN answered x ON x.submission_id = ai.submission_id
  WHERE ai.step_id = '5.4' AND ai.item_id = 'n'
),
shares AS (
  SELECT ai.item_id, SUM(ai.value_number) AS share_total, SUM(ai.value_number * c.n / 100) AS clients_total
  FROM answer_item ai
  JOIN answered x ON x.submission_id = ai.submission_id
  JOIN clients c ON c.submission_id = ai.submission_id
  WHERE ai.step_id = '5.4a' AND ai.attribute = 'percent'
  GROUP BY ai.item_id
)
SELECT o.label AS source, o.hint,
       ROUND(COALESCE(sh.share_total, 0) / NULLIF((SELECT COUNT(*) FROM answered), 0), 1) AS mean_share_pct,
       ROUND(COALESCE(sh.clients_total, 0) / NULLIF((SELECT COUNT(*) FROM answered), 0), 0) AS mean_clients
FROM step_option o
LEFT JOIN shares sh ON sh.item_id = o.option_id
WHERE o.version = 'v3' AND o.step_id = '5.4a' AND o.option_set = 'row'
ORDER BY mean_share_pct DESC, o.seq;


-- [Q9] 9.1 What is most critical to winning: the mean rank of each block (1 = most critical), how often it was ranked
--      1st and in the top 3; beside it, 9.2's verdict on where J.P. Morgan stands on the same block today.
WITH ranks AS (
  SELECT ai.item_id, AVG(ai.value_number) AS mean_rank,
         SUM(CASE WHEN ai.value_number = 1 THEN 1 ELSE 0 END) AS ranked_first,
         SUM(CASE WHEN ai.value_number <= 3 THEN 1 ELSE 0 END) AS in_top3,
         COUNT(*) AS respondents
  FROM answer_item ai
  JOIN answer a ON a.submission_id = ai.submission_id AND a.step_id = ai.step_id AND a.shown
  JOIN submission s ON s.submission_id = a.submission_id
  WHERE s.version = 'v3' AND s.status = 'submitted' AND ai.step_id = '9.1' AND ai.attribute = 'rank'
  GROUP BY ai.item_id
),
ready AS (
  SELECT ai.item_id,
         SUM(CASE WHEN ai.value_text = 'ready' THEN 1 ELSE 0 END) AS ready_now,
         SUM(CASE WHEN ai.value_text = 'fixable' THEN 1 ELSE 0 END) AS fixable_in_a_year,
         SUM(CASE WHEN ai.value_text = 'gap' THEN 1 ELSE 0 END) AS real_gap
  FROM answer_item ai
  JOIN answer a ON a.submission_id = ai.submission_id AND a.step_id = ai.step_id AND a.shown
  JOIN submission s ON s.submission_id = a.submission_id
  WHERE s.version = 'v3' AND s.status = 'submitted' AND ai.step_id = '9.2' AND ai.attribute = 'stamp'
  GROUP BY ai.item_id
)
SELECT b.label AS block, ROUND(r.mean_rank, 2) AS mean_rank, r.ranked_first, r.in_top3, r.respondents,
       COALESCE(y.ready_now, 0) AS ready_now, COALESCE(y.fixable_in_a_year, 0) AS fixable_in_a_year,
       COALESCE(y.real_gap, 0) AS real_gap
FROM step_option b
JOIN ranks r ON r.item_id = b.option_id
LEFT JOIN ready y ON y.item_id = b.option_id
WHERE b.version = 'v3' AND b.step_id = '9.1' AND b.option_set = 'block'
ORDER BY r.mean_rank, b.seq;


-- [Q10] 10.5 The front page: each respondent's headline and quote, latest first.
SELECT s.submission_id, s.submitted_at,
       MAX(CASE WHEN ai.item_id = 'headline' THEN ai.value_text END) AS headline,
       MAX(CASE WHEN ai.item_id = 'quote' THEN ai.value_text END) AS quote
FROM answer_item ai
JOIN answer a ON a.submission_id = ai.submission_id AND a.step_id = ai.step_id AND a.shown
JOIN submission s ON s.submission_id = a.submission_id
WHERE s.version = 'v3' AND s.status = 'submitted' AND ai.step_id = '10.5' AND ai.attribute = 'text'
GROUP BY s.submission_id, s.submitted_at
ORDER BY s.submitted_at DESC;


-- [Q11] Wide export: one row per respondent, one column per answer element, by conditional aggregation
--       (MAX(CASE ...)), which every SQL engine runs. Shown here for a selection of steps; Q12 writes the column for
--       every card, stamp, tile and ranked block. A step that did not show leaves its columns NULL.
SELECT s.submission_id, s.submitted_at, s.device,
       MAX(CASE WHEN ai.step_id = '1.1' THEN ai.item_id END) AS q1_1_core,
       MAX(CASE WHEN ai.step_id = '1.2' THEN ai.item_id END) AS q1_2_most_value,
       MAX(CASE WHEN ai.step_id = '1.3' THEN ai.item_id END) AS q1_3_choose_us_for,
       MAX(CASE WHEN ai.step_id = '1.4' THEN ai.item_id END) AS q1_4_advice_from,
       MAX(CASE WHEN ai.step_id = '2.2' AND ai.item_id = 'securities' THEN ai.value_text END) AS q2_2_securities,
       MAX(CASE WHEN ai.step_id = '2.2' AND ai.item_id = 'alternatives' THEN ai.value_text END) AS q2_2_alternatives,
       MAX(CASE WHEN ai.step_id = '2.2' AND ai.item_id = 'lombard' THEN ai.value_text END) AS q2_2_lombard,
       MAX(CASE WHEN ai.step_id = '2.2a' AND ai.value_number = 1 THEN ai.item_id END) AS q2_2a_first,
       MAX(CASE WHEN ai.step_id = '2.2a' AND ai.value_number = 2 THEN ai.item_id END) AS q2_2a_second,
       MAX(CASE WHEN ai.step_id = '2.2a' AND ai.value_number = 3 THEN ai.item_id END) AS q2_2a_third,
       MAX(CASE WHEN ai.step_id = '2.3' AND ai.item_id = 'engage' AND ai.attribute = 'belongs' THEN ai.value_text END) AS q2_3_engage_belongs,
       MAX(CASE WHEN ai.step_id = '2.3' AND ai.item_id = 'engage' AND ai.attribute = 'who' THEN ai.value_text END) AS q2_3_engage_who,
       MAX(CASE WHEN ai.step_id = '2.4' THEN ai.value_number END) AS q2_4_position,
       MAX(CASE WHEN ai.step_id = '2.4a' THEN ai.item_id END) AS q2_4a_risk_profiles,
       MAX(CASE WHEN ai.step_id = '3.1' AND ai.item_id = 'base' THEN ai.value_number END) AS q3_1_today_pct,
       MAX(CASE WHEN ai.step_id = '3.1' AND ai.item_id = 'four' THEN ai.value_number END) AS q3_1_all_four_pct,
       MAX(CASE WHEN ai.step_id = '4.1' THEN ai.value_number END) AS q4_1_floor_mm,
       MAX(CASE WHEN ai.step_id = '4.2' AND ai.item_id = 'mm' THEN ai.value_number END) AS q4_2_ceiling_mm,
       MAX(CASE WHEN ai.step_id = '4.2' AND ai.attribute IN ('chip', 'opt_out') THEN COALESCE(ai.value_text, ai.item_id) END) AS q4_2_verb,
       MAX(CASE WHEN ai.step_id = '5.1' AND ai.item_id = 'split' THEN ai.value_number END) AS q5_1_cash_mm,
       MAX(CASE WHEN ai.step_id = '5.4' THEN ai.value_number END) AS q5_4_clients_3y,
       MAX(CASE WHEN ai.step_id = '6.1' THEN ai.item_id END) AS q6_1_coverage,
       MAX(CASE WHEN ai.step_id = '6.4' AND ai.item_id = 'md' THEN ai.value_number END) AS q6_4_md,
       MAX(CASE WHEN ai.step_id = '6.4' AND ai.item_id = 'ed' THEN ai.value_number END) AS q6_4_ed,
       MAX(CASE WHEN ai.step_id = '6.4' AND ai.item_id = 'vp' THEN ai.value_number END) AS q6_4_vp,
       MAX(CASE WHEN ai.step_id = '6.4' AND ai.item_id = 'associate' THEN ai.value_number END) AS q6_4_associate,
       MAX(CASE WHEN ai.step_id = '7.1' THEN ai.value_number END) AS q7_1_without_banker_pct,
       MAX(CASE WHEN ai.step_id = '9.1' AND ai.value_number = 1 THEN ai.item_id END) AS q9_1_rank_1,
       MAX(CASE WHEN ai.step_id = '9.1' AND ai.value_number = 2 THEN ai.item_id END) AS q9_1_rank_2,
       MAX(CASE WHEN ai.step_id = '9.1' AND ai.value_number = 3 THEN ai.item_id END) AS q9_1_rank_3,
       MAX(CASE WHEN ai.step_id = '9.4' THEN ai.value_number END) AS q9_4_clients_5y,
       MAX(CASE WHEN ai.step_id = '9.4b' AND ai.attribute = 'market' THEN ai.value_text END) AS q9_4b_market,
       MAX(CASE WHEN ai.step_id = '10.3' AND ai.item_id = 'name' AND ai.attribute = 'text' THEN ai.value_text END) AS q10_3_competitor,
       MAX(CASE WHEN ai.step_id = '10.5' AND ai.item_id = 'headline' THEN ai.value_text END) AS q10_5_headline
FROM submission s
JOIN answer a ON a.submission_id = s.submission_id AND a.shown
JOIN answer_item ai ON ai.submission_id = a.submission_id AND ai.step_id = a.step_id
WHERE s.version = 'v3' AND s.status = 'submitted'
GROUP BY s.submission_id, s.submitted_at, s.device
ORDER BY s.submitted_at;


-- [Q12] The wide export's column list for every card sort, stamp deck, tray sort and ranking, one line per column, in
--       play order, to paste into Q11's SELECT (column names: q<step>__<card>). Reads step_option only.
SELECT 'MAX(CASE WHEN ai.step_id = ''' || o.step_id || ''' AND ai.item_id = ''' || o.option_id || ''' THEN ai.'
       || CASE WHEN st.template = 'rank' THEN 'value_number' ELSE 'value_text' END
       || ' END) AS q' || REPLACE(o.step_id, '.', '_') || '__' || REPLACE(o.option_id, '-', '_') || ',' AS column_sql
FROM step_option o
JOIN step st ON st.version = o.version AND st.step_id = o.step_id
WHERE o.version = 'v3'
  AND ((st.template IN ('piles', 'stamp') AND o.option_set = 'card')
       OR (st.template = 'trays' AND o.option_set = 'tile')
       OR (st.template = 'rank' AND o.option_set = 'block'))
ORDER BY st.seq, o.seq;


-- [Q13] Progress, for reminders: runs by status, and where the ones in progress stopped (chapter and step) and when
--       they last saved. Identity is not read here; join respondent only where that is allowed.
SELECT s.status, st.chapter, s.last_step_id, st.title AS last_step,
       COUNT(*) AS submissions, MAX(s.last_saved_at) AS latest_save
FROM submission s
LEFT JOIN step st ON st.version = s.version AND st.step_id = s.last_step_id
WHERE s.version = 'v3'
GROUP BY s.status, st.seq, st.chapter, s.last_step_id, st.title
ORDER BY s.status, st.seq;


-- [Q14] SIDs by format (identity table: for the people allowed to read it): the usual one letter and six digits, or
--       something else to check by hand. PostgreSQL regular expression; Oracle: REGEXP_LIKE(r.sid, '^[A-Z][0-9]{6}$');
--       SQL Server: r.sid LIKE '[A-Z][0-9][0-9][0-9][0-9][0-9][0-9]'.
SELECT CASE WHEN r.sid ~ '^[A-Z][0-9]{6}$' THEN 'usual: a letter and six digits' ELSE 'other: check by hand' END AS sid_format,
       COUNT(*) AS respondents
FROM respondent r
GROUP BY CASE WHEN r.sid ~ '^[A-Z][0-9]{6}$' THEN 'usual: a letter and six digits' ELSE 'other: check by hand' END;


-- [Q15] Stamp decks (4.3 who gets what, 7.4 people and AI at each step, 8.1 price changes, 8.3 pay changes, 9.2 where
--       J.P. Morgan stands today): respondents per card and stamp, every cell listed.
WITH stamped AS (
  SELECT ai.step_id, ai.item_id AS card_id, ai.value_text AS stamp_id
  FROM answer_item ai
  JOIN answer a ON a.submission_id = ai.submission_id AND a.step_id = ai.step_id AND a.shown
  JOIN submission s ON s.submission_id = a.submission_id
  WHERE s.version = 'v3' AND s.status = 'submitted' AND ai.attribute = 'stamp'
),
grid AS (
  SELECT st.seq AS step_seq, c.step_id, c.option_id AS card_id, c.label AS card, c.seq AS card_seq,
         p.option_id AS stamp_id, p.label AS stamp, p.seq AS stamp_seq
  FROM step_option c
  JOIN step_option p ON p.version = c.version AND p.step_id = c.step_id AND p.option_set = 'stamp'
  JOIN step st ON st.version = c.version AND st.step_id = c.step_id
  WHERE c.version = 'v3' AND c.option_set = 'card' AND st.template = 'stamp'
)
SELECT g.step_id, g.card, g.stamp,
       COUNT(x.card_id) AS respondents,
       ROUND(100.0 * COUNT(x.card_id) / NULLIF(SUM(COUNT(x.card_id)) OVER (PARTITION BY g.step_id, g.card_id), 0), 1) AS pct_of_card
FROM grid g
LEFT JOIN stamped x ON x.step_id = g.step_id AND x.card_id = g.card_id AND x.stamp_id = g.stamp_id
GROUP BY g.step_seq, g.step_id, g.card_seq, g.card_id, g.card, g.stamp_seq, g.stamp
ORDER BY g.step_seq, g.card_seq, g.stamp_seq;


-- [Q16] Tray sorts (2.6 who is best placed to provide each product, 5.3 local bank or J.P. Morgan): respondents per tile
--       and tray. On 2.6 a product put in Not for HNW on 2.2 is not offered, so its tile counts fewer respondents.
WITH placed AS (
  SELECT ai.step_id, ai.item_id AS tile_id, ai.value_text AS tray_id
  FROM answer_item ai
  JOIN answer a ON a.submission_id = ai.submission_id AND a.step_id = ai.step_id AND a.shown
  JOIN submission s ON s.submission_id = a.submission_id
  WHERE s.version = 'v3' AND s.status = 'submitted' AND ai.attribute = 'tray'
)
SELECT t.step_id, t.label AS tile, y.label AS tray, COUNT(p.tile_id) AS respondents
FROM step_option t
JOIN step_option y ON y.version = t.version AND y.step_id = t.step_id AND y.option_set = 'tray'
LEFT JOIN placed p ON p.step_id = t.step_id AND p.tile_id = t.option_id AND p.tray_id = y.option_id
WHERE t.version = 'v3' AND t.option_set = 'tile'
GROUP BY t.step_id, t.seq, t.label, y.seq, y.label
ORDER BY t.step_id, t.seq, y.seq;


-- [Q17] 2.3 Ways of investing: for Execute, Engage and Entrust, where each belongs in the offer, who the client mainly
--       deals with, and how many respondents ticked each product as covered.
SELECT it.label AS way_of_investing, pt.label AS part, po.label AS answer, COUNT(*) AS respondents
FROM answer_item ai
JOIN answer a ON a.submission_id = ai.submission_id AND a.step_id = ai.step_id AND a.shown
JOIN submission s ON s.submission_id = a.submission_id
JOIN step_option it ON it.version = s.version AND it.step_id = '2.3' AND it.option_set = 'item' AND it.option_id = ai.item_id
JOIN step_option pt ON pt.version = s.version AND pt.step_id = '2.3' AND pt.option_set = 'part' AND pt.option_id = ai.attribute
JOIN step_option po ON po.version = s.version AND po.step_id = '2.3' AND po.option_set = 'part_option'
                   AND po.parent_option_id = ai.attribute AND po.option_id = ai.value_text
WHERE s.version = 'v3' AND s.status = 'submitted' AND ai.step_id = '2.3'
GROUP BY it.seq, it.label, pt.seq, pt.label, po.seq, po.label
ORDER BY it.seq, pt.seq, po.seq;


-- [Q18] The typed numbers: 4.1 floor and 4.2 ceiling ($mm), 5.4 and 9.4 client numbers, 6.1a and 7.4a clients per
--       banker, 6.2 meetings, 6.4a bankers from inside, 7.1 per cent of contact without a banker, 3.1 shares of
--       wallet (per cent): how many answered, lowest, median, mean, highest. 7.1's item_id is the stop chosen (its
--       value), so 7.1 is grouped as one item, 'percent'.
SELECT ai.step_id,
       CASE WHEN ai.step_id = '7.1' THEN 'percent' ELSE ai.item_id END AS item_id,
       ai.attribute, COUNT(*) AS n,
       MIN(ai.value_number) AS lowest,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY ai.value_number) AS median,
       ROUND(AVG(ai.value_number), 2) AS mean,
       MAX(ai.value_number) AS highest
FROM answer_item ai
JOIN answer a ON a.submission_id = ai.submission_id AND a.step_id = ai.step_id AND a.shown
JOIN submission s ON s.submission_id = a.submission_id
JOIN step st ON st.version = s.version AND st.step_id = ai.step_id
WHERE s.version = 'v3' AND s.status = 'submitted'
  AND ((st.template = 'sentence' AND st.step_id <> '4.3a' AND ai.attribute IN ('amount_mm', 'number'))
       OR ai.step_id IN ('3.1', '7.1'))
GROUP BY st.seq, ai.step_id, CASE WHEN ai.step_id = '7.1' THEN 'percent' ELSE ai.item_id END, ai.attribute
ORDER BY st.seq, MIN(ai.seq);


-- [Q19] 5.1 and 5.2 The typical $10mm client: the mean $mm each holder has in banking and cash (5.1) and in investments
--       (5.2), and the mean share of the whole $10mm each holder has. One denominator for both: the submitted runs
--       with a 5.1 answer. A row left blank counts as 0, and so does 5.2 for a run whose split was $10mm (nothing to
--       place), so the means of all holders add up to $10mm.
WITH runs AS (
  SELECT a.submission_id
  FROM answer a
  JOIN submission s ON s.submission_id = a.submission_id
  WHERE s.version = 'v3' AND s.status = 'submitted' AND a.step_id = '5.1' AND a.shown AND a.value_json IS NOT NULL
),
sums AS (
  SELECT ai.step_id, ai.item_id, SUM(ai.value_number) AS total
  FROM answer_item ai
  JOIN runs r ON r.submission_id = ai.submission_id
  JOIN answer a ON a.submission_id = ai.submission_id AND a.step_id = ai.step_id AND a.shown
  WHERE ai.step_id IN ('5.1', '5.2') AND ai.attribute = 'amount_mm' AND ai.item_id <> 'split'
  GROUP BY ai.step_id, ai.item_id
)
SELECT h.label AS holder,
       ROUND(COALESCE(c.total, 0) / NULLIF(n.runs, 0), 2) AS mean_cash_mm,
       ROUND(COALESCE(i.total, 0) / NULLIF(n.runs, 0), 2) AS mean_investments_mm,
       ROUND(10 * (COALESCE(c.total, 0) + COALESCE(i.total, 0)) / NULLIF(n.runs, 0), 1) AS mean_share_of_10mm_pct
FROM step_option h
CROSS JOIN (SELECT COUNT(*) AS runs FROM runs) n
LEFT JOIN sums c ON c.step_id = '5.1' AND c.item_id = h.option_id
LEFT JOIN sums i ON i.step_id = '5.2' AND i.item_id = h.option_id
WHERE h.version = 'v3' AND h.step_id = '5.1' AND h.option_set = 'row'
ORDER BY h.seq;
