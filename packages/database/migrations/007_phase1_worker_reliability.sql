create index outbox_jobs_stale_processing_idx
on outbox_jobs (locked_at, id)
where status = 'PROCESSING';

create index outbox_jobs_failed_created_idx
on outbox_jobs (created_at desc, id desc)
where status = 'FAILED';
