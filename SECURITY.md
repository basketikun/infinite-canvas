# Security Policy

## Supported Versions

DSH FreeCanvas is in active development. Security fixes are accepted for the
`main` branch and the latest tagged release. Older versions may be handled on a
best-effort basis.

## Reporting a Vulnerability

Please do not open a public issue with exploit details, credentials, private
API keys, proof-of-concept code, or screenshots that reveal sensitive data.

Use GitHub private vulnerability reporting or a GitHub Security Advisory for
this repository. If neither option is available, open a public issue asking the
maintainers to enable a private reporting channel. Do not include technical
details or sensitive data in that issue.

Please include:

- Affected version, commit, branch, or deployment mode.
- Clear reproduction steps.
- Impact and attack scenario.
- Any relevant logs, screenshots, or proof of concept, with secrets removed.
- Whether the issue affects local-only usage, hosted deployments, browser
  storage, WebDAV sync, AI provider configuration, or API proxy behavior.

## Scope

### Canvas node plugins

The canvas supports third-party node plugins loaded from a remote URL. By
design, an installed plugin's code runs directly inside the web app with full
access to the page, including locally stored data such as AI API keys. This is
an intentional trade-off for extensibility, and the installer shows a warning
before installing. Therefore:

- Only install plugins from sources you trust.
- Reports that a *malicious plugin* can access page data or API keys are **out
  of scope** — that is the documented behavior of the trust model.
- Reports **in scope** include: the app loading/executing plugin code without
  the install confirmation, a plugin escaping its declared node type to break
  core app integrity in ways not implied by "runs in the page", or the plugin
  source cache being writable by an unrelated origin.

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
