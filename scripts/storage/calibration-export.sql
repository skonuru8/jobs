-- calibration-export.sql — pulls all labeled jobs with score breakdown
-- and judge verdict for tuning the 5 scoring weights against ground truth.
-- Use:
--   psql $DATABASE_URL -f storage/scripts/calibration-export.sql -A -F',' > labels.csv

SELECT
  j.job_id,
  j.title,
  j.company,
  j.source,
  s.total      AS score_total,
  s.skills, s.semantic, s.yoe, s.seniority, s.location,
  jv.verdict   AS judge_verdict,
  jv.bucket    AS judge_bucket,
  l.label      AS user_label,
  l.notes,
  l.labeled_at
FROM labels l
JOIN jobs j            ON j.job_id  = l.job_id  AND j.run_id  = l.run_id
JOIN scores s          ON s.job_id  = l.job_id  AND s.run_id  = l.run_id
JOIN judge_verdicts jv ON jv.job_id = l.job_id  AND jv.run_id = l.run_id
ORDER BY s.total DESC;

