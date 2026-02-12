---
name: npm
description: Manage npm packages — install, publish, version bump, audit, and run scripts using the npm tool.
---

# NPM Skill

Use the `npm` tool to manage Node.js packages and run npm workflows.

## Common workflows

### Install dependencies
```
npm tool: action=install
npm tool: action=install, args="express @types/express --save-dev"
```

### Run scripts
```
npm tool: action=run, args="dev"
npm tool: action=test
npm tool: action=build
```

### Publish a package
Always do a dry run first to verify what will be published:
```
npm tool: action=publish, dry_run=true
```
Then publish for real:
```
npm tool: action=publish
npm tool: action=publish, args="--tag beta"
```

### Version bumps
Preview first, then apply:
```
npm tool: action=version, args="patch", dry_run=true
npm tool: action=version, args="minor"
```

### Check for issues
```
npm tool: action=outdated
npm tool: action=audit
npm tool: action=audit, args="--fix"
```

### Inspect packages
```
npm tool: action=info, args="react"
npm tool: action=list, args="--depth=0"
```

## Guidelines

1. **Before publishing**, always read `package.json` to verify name, version, files, and registry config.
2. **Use `dry_run: true`** for publish, pack, and version to preview before committing.
3. **Check `npm outdated`** before updating to understand what will change.
4. **Run `npm audit`** after installing new dependencies.
5. When working in a monorepo, use the `path` parameter to target specific packages.
