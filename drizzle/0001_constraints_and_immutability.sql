-- Custom migration for PRD §8.2 Rule 10 DB constraints and audit immutability triggers

-- 1. Rule 10 check: penalty_applied = min(penalty_points, points_awarded), final_points = points_awarded - penalty_applied
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_scores_chk" CHECK (
  ("review_status" IN ('approved','rejected')
     AND "points_awarded" IS NOT NULL AND "penalty_applied" IS NOT NULL AND "final_points" IS NOT NULL
     AND "points_awarded" >= 0
     AND "penalty_applied" = LEAST("penalty_points", "points_awarded")
     AND "final_points" = "points_awarded" - "penalty_applied"
     AND "final_points" >= 0)
  OR
  ("review_status" IN ('pending_review','needs_changes')
     AND "points_awarded" IS NULL AND "penalty_applied" IS NULL AND "final_points" IS NULL)
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_append_only ON "history_audit_logs";
--> statement-breakpoint
CREATE TRIGGER audit_append_only
  BEFORE UPDATE OR DELETE ON "history_audit_logs"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS reviews_append_only ON "reviews";
--> statement-breakpoint
CREATE TRIGGER reviews_append_only
  BEFORE UPDATE OR DELETE ON "reviews"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS versions_append_only ON "submission_versions";
--> statement-breakpoint
CREATE TRIGGER versions_append_only
  BEFORE UPDATE OR DELETE ON "submission_versions"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
