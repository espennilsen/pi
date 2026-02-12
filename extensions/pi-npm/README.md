# pi-npm

NPM workflow extension for [pi](https://github.com/nichochar/pi-coding-agent). Gives the agent a single `npm` tool with common package management commands including publish.

## Actions

| Action      | Description                        | Example `args`             |
| ----------- | ---------------------------------- | -------------------------- |
| `init`      | Create a new `package.json`        | `-y`                       |
| `install`   | Install dependencies               | `express`, `--save-dev ts` |
| `uninstall` | Remove a package                   | `lodash`                   |
| `update`    | Update packages                    | `react`                    |
| `outdated`  | List outdated packages             |                            |
| `run`       | Run a package.json script          | `dev`, `lint`              |
| `test`      | Run tests (`npm test`)             |                            |
| `build`     | Run the `build` script             |                            |
| `publish`   | Publish to npm registry            | `--tag beta`               |
| `pack`      | Create a tarball                   |                            |
| `version`   | Bump version                       | `patch`, `minor`, `major`  |
| `info`      | Show package info                  | `react versions`           |
| `list`      | List installed packages            | `--depth=0`                |
| `audit`     | Security audit                     | `--fix`                    |
| `link`      | Symlink a local package            | `../my-lib`                |

## Parameters

- **action** (required) — one of the actions above
- **args** — additional CLI arguments
- **path** — working directory (defaults to project root)
- **dry_run** — if `true`, adds `--dry-run` to publish/pack/version

## Install

```bash
pi install .    # from this directory
pi -e .         # load without installing
```
