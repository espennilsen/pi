# Pi Tools, Extensions, and Skills

This repo is a scaffold for a shareable pi package that bundles your custom tools (via extensions) and skills.

## Structure

```
extensions/   # TypeScript extensions (tools, commands, hooks)
skills/       # Agent Skills (SKILL.md directories)
```

## Local testing

- Run a single extension:
  ```bash
  pi -e ./extensions/sample-tools.ts
  ```
- Load the whole package without installing:
  ```bash
  pi -e .
  ```

## Install as a package

From this directory:

```bash
pi install .
```

Or from git/npm once published:

```bash
pi install git:github.com/you/your-repo
pi install npm:@you/your-package
```

## Customize

- Update `package.json` (name, description, version)
- Replace the sample extension in `extensions/`
- Replace the sample skill in `skills/`
- Update `LICENSE` with your name (or change the license)
