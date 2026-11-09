// Values validated by Walid for the Privacy Policy. Keep the page in sync by
// importing from here rather than repeating them.
export const PRIVACY_CONTROLLER = "Yokkai Collec'";
export const PRIVACY_CONTACT_EMAIL = "yokkaicollec@gmail.com";
export const PRIVACY_MINIMUM_AGE = 16;
export const PRIVACY_LAST_UPDATED = "2026-11-09";

// Durations found in the code (ops/storage_maintenance.py, docs/ops-disk-cleanup.md,
// supabase/migrations/20261009000006_cron_history_retention.sql and the
// anti-cheat network observation migration).
export const BACKUP_RETENTION_DAYS = 14;
export const SERVER_LOG_RETENTION_DAYS = 7;

// TODO(walid): no duration is defined in the code or docs for the items below.
// While null, the page states the purpose without a duration.
export const BILLING_RECORD_RETENTION: string | null = null;
export const DELETION_LOG_RETENTION: string | null = null;
export const AUTH_LOG_RETENTION: string | null = null;
