# Cloud Deployment Runbook

This document describes the reusable production deployment contract. Do not commit real server IPs, SSH ports, secrets, API keys, private hostnames, or release-specific credentials here.

## Recommended production shape

```text
HTTPS reverse proxy
        ↓
Loomi Node service
        ↓
Persistent data directory
├ SQLite database
├ uploads
└ model-settings encryption key
```

Recommended baseline:

- Linux server (Ubuntu LTS or equivalent).
- Node.js version compatible with `package.json`.
- Python environment when PDF/DOCX export or OCR requires it.
- systemd or equivalent process supervisor.
- HTTPS before uploading real resumes.
- Persistent data directory outside disposable release folders.

## Required production configuration

At minimum configure:

```dotenv
RESUME_PROTOCOL_ORIGIN=https://your-domain.example
RESUME_PROTOCOL_SECURE_COOKIES=true
RESUME_PROTOCOL_DATA_DIR=/persistent/path/data
```

Model/runtime variables should come from the server environment or protected env file, never from committed source.

## Release layout

A safe release layout is:

```text
/opt/resume-protocol/
├ releases/
│  ├ <release-a>/
│  └ <release-b>/
└ current -> releases/<active-release>

/var/lib/resume-protocol/data/
```

Application upgrades may replace `current`, but must not replace or delete the persistent data directory.

## Backup

For a consistent backup:

1. stop the application service;
2. copy the entire persistent data directory;
3. verify SQLite, uploads and model-settings encryption material are present;
4. restart the service;
5. verify `/api/health` and authenticated access.

Do not back up only a live SQLite main file while WAL files may still contain committed data.

## Upgrade

Before activation:

```text
npm ci
npm test
npm run build
```

If Python export/OCR dependencies are used, validate them in the same service-user environment.

Activation should be reversible: keep the prior release until the new release passes health, authentication, upload, Agent runtime and export smoke tests.

## Smoke checks

At minimum verify:

- public app / static assets return successfully;
- `/api/health` succeeds;
- unauthenticated private APIs return 401;
- untrusted origins are rejected where required;
- login and an authenticated Conversation work;
- upload and document reading work;
- one Agent SDK request completes;
- PDF/DOCX export works when enabled;
- persistent data survives a service restart.

## OCR

Linux deployments may install Tesseract and Chinese language data when local OCR is desired. See `docs/pdf-reading.md` for the document-reading contract.

## Security

- Use HTTPS for real candidate data.
- Keep service env files readable only by the deployment/service account.
- Never place production secrets in Git.
- Candidate files are private data and must remain behind authentication and ownership checks.
- Do not expose database, model settings, crawler maintenance, or internal job-source controls directly to the public UI.

Operational host details belong in private infrastructure notes or deployment tooling, not this public repository.
