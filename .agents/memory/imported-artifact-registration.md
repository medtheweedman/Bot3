---
name: Imported artifact registration
description: Workspace registration needed after importing a repo that already contains artifact metadata.
---

When a GitHub repository includes artifact metadata, importing its files may not register the artifact in the current Replit project or create its managed workflow. Verify registration separately and preserve the imported source while retaining the project-generated service metadata.

**Why:** repository files and the workspace's artifact registry are separate; the source manifest alone did not make the imported app appear in the artifact list.

**How to apply:** after a repository import, check that its app is present in the artifact list and has a workflow before presenting or running it.