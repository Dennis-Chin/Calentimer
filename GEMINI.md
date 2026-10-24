# Calentimer - Assistant Instructions & Workspace Rules

## 1. Tool Selection & Code Inspection
- **Strictly use built-in tools for inspection**: ALWAYS use the built-in `read_file` tool to inspect code, read files, search contents, and review implementations.
- **No shell/node inspection commands**: NEVER use shell commands (`run_command` with `node -e`, PowerShell `Select-String`, `Get-ChildItem`, `grep`, `cat`, etc.) simply to read code, search text, or verify tokens. This prevents unwanted interactive approval prompts.
- **Reserved shell commands**: Shell commands (`run_command`) are strictly reserved for necessary external runtime tasks:
  - Starting or restarting dev servers
  - Running unit test suites when requested or needed for verification
  - Git operations (`git commit`, `git push`) when requested or deploying

## 2. Syntax & Compatibility Rules
- **No Optional Chaining or Nullish Coalescing**: Strictly DO NOT use `?.` or `??` syntax anywhere in JavaScript files. Older mobile browser runtimes and WebViews throw `Uncaught SyntaxError: Unexpected token '?'`. Always use explicit boolean checks (`obj && obj.prop`, `typeof x !== 'undefined' ? x : default`).
- **Preserve Documentation**: Maintain existing comments, docstrings, and structure across all files.
