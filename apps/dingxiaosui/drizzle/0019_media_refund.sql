-- A dropped refund must stay pending until the center confirms the reservation was released.
ALTER TABLE media_jobs ADD COLUMN refund_state TEXT NOT NULL DEFAULT 'none';
