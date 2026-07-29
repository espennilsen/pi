# Upstream documentation fallback

When installed `herdr --help` does not provide enough information, use the upstream documentation repository:

- Documentation root: https://github.com/ogulcancelik/herdr/tree/master/docs/versions
- Versioned docs pattern: `https://github.com/ogulcancelik/herdr/tree/master/docs/versions/<version>/website/src/content/docs`
- CLI reference: `.../cli-reference.mdx`
- Install/update: `.../install.mdx`
- Agents and integrations: `.../agents.mdx`
- Releases: https://github.com/ogulcancelik/herdr/releases

## Procedure

1. Run `herdr --version` and use that version's docs directory if it exists.
2. If it does not, inspect the nearest documented release and the current docs, but label the advice as potentially version-dependent.
3. Confirm exact command spelling and flags with local `--help` before executing anything mutating.
