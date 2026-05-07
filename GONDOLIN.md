# Gondolin Sandbox Findings

This note summarizes the extension-tool sandboxing review for considering either [`pasky/pi-gondolin`](https://github.com/pasky/pi-gondolin) or a local Gondolin-style Pi extension.

## Scope reviewed

Searched `extensions/**/*.ts` for `registerTool(...)`, excluding `node_modules` and `.pi` directories.

Findings:

- 63 extension-registered LLM tools were found.
- `pi-gondolin` only overrides Pi's built-in tools:
  - `read`
  - `write`
  - `edit`
  - `bash`
  - user `!` bash commands
- It does not automatically sandbox custom extension tools, because those run host-side TypeScript directly.

## Main concern

The highest concern is tools that accept model-controlled paths, cwd values, project names that resolve to paths, or commands. These can be redirected to read or operate on files outside the current project cwd.

Some tools legitimately need access to `~/.pi/agent` or other configured directories internally. Those are less concerning when the model cannot redirect the path through tool parameters.

## Highest risk: redirectable outside cwd

### `notify` (`pi-channels`)

- Parameter: `filePath`
- Current behavior: requires an absolute path and sends that file as an attachment.
- Risk: direct file exfiltration of any readable host file.
- Suggested policy: require path inside cwd or an explicit allowlisted export directory.

### `subagent`

- Parameters: `cwd`, `extensions`, `skills`
- Current behavior: spawns a new Pi subprocess with model-selected cwd and optional extension/skill paths.
- Risk: can start a fresh agent outside cwd, potentially with tools enabled.
- Suggested policy: restrict `cwd` to cwd/worktrees/known project roots; restrict extension and skill paths to allowlists.

### `npm`

- Parameter: `path`
- Current behavior: `path.resolve(cwd, params.path)`, so absolute paths are accepted.
- Risk: runs npm commands/scripts outside cwd. Scripts can read arbitrary files.
- Suggested policy: reject absolute paths outside cwd; optionally require confirmation for `run`, `publish`, `version`, `link`, `install`.

### `cmux_split` and `cmux_send`

- Parameters: command text or text/key input to terminal panes.
- Risk: indirect arbitrary shell execution if a pane is a shell.
- Suggested policy: require confirmation before sending commands/text containing shell metacharacters or file-read patterns; consider disabling by default in sandboxed sessions.

### `cmux_browser`

- Parameters: `path` for download/state save/load, JS `eval`/script injection actions.
- Risk: browser state or downloads can touch host paths via cmux backend; JS eval is powerful.
- Suggested policy: restrict `path` to cwd or temp; require confirmation/deny for `eval`, `addinitscript`, `addscript`, `state`, and `download` with custom paths.

## Medium risk: path-scoped but intentional/specialized

### `workon`

- Parameter: `project`
- Current behavior: can resolve absolute paths and read `AGENTS.md`, git status, td state, dependency metadata, and PR info for that path.
- Risk: model can inspect project metadata outside cwd.
- Suggested policy: allow only configured dev roots or known project registry entries.

### `project_init`

- Parameter: `project`
- Current behavior: can resolve absolute paths, scaffold `AGENTS.md`, `.pi/settings.json`, and run `td init`.
- Risk: writes outside cwd.
- Suggested policy: require confirmation for any target outside cwd; preferably allow only known dev roots.

### `finance`

- Parameter: `file_path` for `import_bank` and `import_bank_directory`.
- Current behavior: reads bank export files/directories through finance import parsers.
- Risk: redirectable local file read, though constrained by parser expectations.
- Suggested policy: restrict imports to an allowlisted downloads/imports directory.

### `obsidian`

- Parameter: `path`
- Current behavior: reads/writes inside the configured vault root.
- Risk: outside cwd by design; model can access any note in the configured vault.
- Suggested policy: keep enabled only when vault access is desired; optionally restrict to specific vault subdirectories.

## Lower risk / acceptable internal access

### `memory_read`, `memory_write`, `memory_search`

- No model-controlled filesystem path parameter.
- Uses configured/internal memory base path.
- This matches the acceptable pattern: the tool uses its own storage internally, and the agent cannot redirect it to arbitrary paths.

### `gmail download_attachment`

- Parameter: `save_path`
- Current behavior: resolves against `ctx.cwd` and blocks traversal outside cwd.
- Appears aligned with cwd-bound behavior.

### `web_fetch`

- No local input path.
- Writes truncated responses to temp files internally.
- Not a local file-read vector.

### `projects`

- Parameter: `path` for hide/unhide/source management.
- Primarily affects scan metadata. It can broaden future project scanning, so it is worth gating but not a direct file exfiltration vector by itself.

## Recommended approach

Use Gondolin for built-ins, but pair it with a host-side custom tool gate.

A good default policy:

1. Override built-in `read`, `write`, `edit`, and `bash` through Gondolin.
2. Add a `tool_call` policy extension for custom tools.
3. Allow tools with no model-controlled path/cwd/command behavior.
4. Allow tools that only use internal configured directories, such as `memory_*`.
5. Confirm or deny tools that accept redirectable host paths, cwd, project paths, or command text.

## Suggested deny/confirm list

Require confirmation or block by default:

```text
notify
subagent
npm
cmux_send
cmux_split
cmux_browser
workon
project_init
finance
obsidian
```

Priority fixes:

1. `notify.send_file`: require `filePath` inside cwd or an allowlisted directory.
2. `subagent.cwd`, `npm.path`, `workon.project`, `project_init.project`, and `finance.file_path`: reject absolute paths outside cwd unless explicitly allowlisted.
3. `cmux_send`/`cmux_split`: treat as command execution and require confirmation in sandboxed sessions.

## Policy shape for a local gate

A local Gondolin companion extension should classify tools by parameter risk rather than by extension name alone.

Example rules:

- `path`, `filePath`, `file_path`, `save_path`, `cwd`, and `project` values must resolve inside cwd unless the target tool is explicitly allowlisted.
- Internal tool storage under `~/.pi/agent` is allowed only when the path is not model-controlled.
- Absolute model-provided paths are denied by default.
- `~` expansion in model-provided paths is denied by default.
- Terminal/control tools are command-equivalent and require confirmation.
- Tool outputs should not disclose denied file contents or expanded sensitive paths beyond what is needed for debugging.

## Bottom line

`pi-gondolin` is useful but incomplete for this extension set. It protects the built-in file/shell tools, but the larger risk surface is custom tools with host-side path, cwd, terminal, or subprocess capabilities. The safest setup is Gondolin plus an explicit custom-tool gate for redirectable paths and command-equivalent tools.
