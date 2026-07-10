# AGENTS.md

## GitHub

- Do not run `git commit`, `git push`, or other GitHub publishing operations unless the user explicitly gives a clear instruction to commit and/or push in the current conversation.
- GitHub remote operations should use SSH, not HTTPS.
- Repository SSH URL: `git@github.com:wojimmy666-code/recruitment-assistant.git`
- When configuring `origin`, use:

```bash
git remote set-url origin git@github.com:wojimmy666-code/recruitment-assistant.git
```
