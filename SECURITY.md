# Security Policy

## Supported Versions

infinite-canvas is in active development. Security fixes are accepted for the
`main` branch and the latest tagged release. Older versions may be handled on a
best-effort basis.

## Reporting a Vulnerability

Please do not open a public issue with exploit details, credentials, private
API keys, proof-of-concept code, or screenshots that reveal sensitive data.

Preferred reporting channels:

1. Use GitHub private vulnerability reporting or a GitHub Security Advisory for
   this repository, if available.
2. If a private GitHub report is not available, email `1844025705@qq.com` with
   the subject `[infinite-canvas security]`.
3. If neither private channel is available, open a public issue that asks for a
   private contact channel and does not include technical exploit details.

Please include:

- Affected version, commit, branch, or deployment mode.
- Clear reproduction steps.
- Impact and attack scenario.
- Any relevant logs, screenshots, or proof of concept, with secrets removed.
- Whether the issue affects local-only usage, hosted deployments, browser
  storage, WebDAV sync, AI provider configuration, or API proxy behavior.

## Scope

Examples of in-scope reports:

- Cross-site scripting or token exfiltration in the web app.
- Exposure of locally stored API keys or synced canvas data caused by project
  code.
- Unsafe file handling, import/export behavior, or WebDAV proxy behavior.
- Authentication, authorization, or access-control flaws in project-managed
  features.
- Supply-chain issues that are exploitable through this repository's shipped
  code or default configuration.

Examples that are usually out of scope:

- Vulnerabilities in third-party AI providers, model APIs, hosting platforms,
  or browser extensions outside this repository.
- Compromise of a user's own API key outside the app.
- Denial-of-service reports that require unrealistic traffic volume or physical
  access to the user's device.
- Missing security headers without a demonstrated exploit path.
- Social engineering, phishing, spam, or account recovery requests.
- Dependency reports without a practical impact on this project.

## Disclosure

The maintainers aim to acknowledge valid reports within 7 days and coordinate a
fix before public disclosure. Response and fix timelines are best effort for
this community project.

Please allow time for investigation and remediation before publishing details.
Credit will be given on request unless you prefer to remain anonymous.

## Sensitive Config Migration

Older Infinite Canvas builds stored AI API keys, WebDAV credentials, and model
channel secrets inside the browser-persisted `infinite-canvas:ai_config_store`
entry.

Current builds add a separate browser-persisted secret store at
`infinite-canvas:secret_store`. Model request resolution first reads channel API
keys from this secret store, then falls back to legacy channel fields in
`infinite-canvas:ai_config_store` so existing local configurations keep working
during the migration window.

The app configuration modal includes a "清理敏感信息" action. It clears AI API
keys, WebDAV password data, and Agent token data from both the new secret store
and the legacy config store. On shared or untrusted devices, users should also
clear browser site data for this origin.

This client-side separation is a transition step, not a server-side vault. Any
script or browser extension with access to this origin may still read browser
storage, so avoid entering production credentials on untrusted deployments.
