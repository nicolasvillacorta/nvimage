# Code signing policy

> **Status: not active yet.** NVTabs releases are currently **unsigned**. This policy describes how signing
> will work once the project is approved by SignPath Foundation.

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

## Scope

Only the official Windows builds of NVTabs published in the
[Releases](https://github.com/nicolasvillacorta/nvtabs/releases) section of this repository are signed.
They are built automatically by GitHub Actions (`.github/workflows/release.yml`) from the public
source code in this repository. Builds made by anyone else, or from forks, are not signed with this certificate.

## Team roles

| Role | Members |
|------|---------|
| Committers and reviewers | [Nicolas Villacorta](https://github.com/nicolasvillacorta) |
| Approvers | [Nicolas Villacorta](https://github.com/nicolasvillacorta) |

Every signing request must be manually approved by an approver. All team members use
multi-factor authentication for GitHub and SignPath.

## Privacy policy

This program will not transfer any information to other networked systems unless specifically
requested by the user or the person installing or operating it.

NVTabs works fully offline: photos, settings and thumbnails are stored only on the user's computer
(`Documents\NVTabs` and `%APPDATA%\NVTabs`).

---

### Resumen en español

- Solo se firman las versiones oficiales publicadas en *Releases*, compiladas automáticamente por GitHub
  a partir del código público de este repositorio.
- Cada firma la aprueba manualmente Nicolas Villacorta.
- NVTabs no envía información a internet: todo queda en la computadora del usuario.
