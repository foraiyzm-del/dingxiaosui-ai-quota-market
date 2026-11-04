-- A saved file and a confirmed quota settlement are separate steps.
-- delivery_state pending means the file is local and accept/reject still needs a retry.
ALTER TABLE media_jobs ADD COLUMN delivery_state TEXT NOT NULL DEFAULT 'none';
ALTER TABLE media_jobs ADD COLUMN save_attempts INTEGER NOT NULL DEFAULT 0;
