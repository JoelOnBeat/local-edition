# Local Edition

See docs/CONTRACT.md and docs/BUILD.md. Run: npm run dev, npm test, npm run typecheck, npm run lint.

## NeMo Guardrails jobs: started from the CLI, on demand

The weekly rebuild runs on a Cloudflare cron (Workflow, Token Factory and Tavily only). The NeMo Guardrails jobs (`certify`, `eval`, `import`) run on
Nebius Serverless Jobs and are **started from a developer's CLI session, on demand**: nothing schedules them, and nothing on Cloudflare calls the
Nebius AI Cloud control plane (it answers Cloudflare egress with a 522; see `docs/NEBIUS-REST.md`). Each run posts its results to
https://localedition.pages.dev and shows on the proof page as a `manual` run.

    npx tsx scripts/nebius-job.ts certify eval --dry-run   # validates the request, creates nothing
    npx tsx scripts/nebius-job.ts certify eval             # creates the job, polls, reads the logs, deletes the job

It needs `LE_JOB_SECRET` and `NEBIUS_API_KEY` in the environment and the `hackathon-jobs-sa` Nebius CLI profile (`docs/BUILD.md`).
