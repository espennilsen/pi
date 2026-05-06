---
name: docstring-generator
description: >
  Generate and update language-idiomatic doc comments for TypeScript
  (TSDoc/JSDoc) and Rust (Rustdoc). Use when asked to "add docs", "document
  this file", "generate docstrings", "add JSDoc", "add Rustdoc", "write TSDoc",
  or when working with TypeScript or Rust source files that need documentation
  comments. Supports file-level and selection-level operations. Deterministic
  and idempotent — safe to run repeatedly on the same code. Does NOT change
  behavior, rename symbols, or refactor code.
---

# Docstring Generator

Generates or updates doc comments for TypeScript and Rust source files. The
skill analyzes the public API surface (functions, methods, classes/structs,
traits/interfaces, enums) and produces language-idiomatic documentation.

## Inputs

| Input | Type | Required | Description |
|---|---|---|---|
| `language` | string | yes | `"typescript"` or `"rust"` |
| `file_path` | string | yes | Path of the file being edited |
| `full_text` | string | yes | Entire contents of the file |
| `selection_range` | object | no | `{ start_line, end_line }` (1-based, inclusive) |
| `mode` | string | no | `"update_missing"` (default) or `"update_all"` |
| `public_only` | boolean | no | If true (default), only document exported/public items |

## Workflow

### Step 1: Parse declarations

Mentally parse `full_text` to find all declarations relevant to the language,
`public_only`, and `selection_range` settings.

**TypeScript declarations to document:**
- Exported functions, async functions, and generators
- Exported classes and their public/protected methods
- Exported interfaces and type aliases
- Exported enums
- Exported const/let/var at module level (when they hold complex types)

**Rust declarations to document:**
- `pub fn` (free functions and methods)
- `pub struct` and its `pub` fields
- `pub enum` and its variants
- `pub trait` and its method signatures
- `pub type` and `pub const` items
- `pub mod` (public modules)

### Step 2: Generate doc comments

For each target declaration, follow the language-specific rules below.

### Step 3: Merge into file

Insert or update the doc comment immediately before the declaration, preserving
all existing formatting, indentation, and code. Return the full `updated_text`
with only doc comment lines changed.

## Behavior & Style Rules

### General Rules (all languages)

- **Preserve everything**: Do not change code semantics, identifiers,
  formatting, or indentation. Only touch doc comment lines.
- **No speculation**: If unsure about behavior, write neutral high-level
  descriptions instead of guessing.
- **Present tense, concise**: Describe what the item *does*, not what it *is*.
  Avoid restating obvious type information unless it aids clarity.
- **Idempotent**: Running the skill twice on the same file should produce the
  same result.
- **Respect developer notes**: In `update_all` mode, preserve explicit warnings,
  safety notes, panic documentation, and custom annotations.

### TypeScript Rules

**Comment style**: Use `/** ... */` TSDoc/JSDoc block comments immediately
before the declaration.

**Functions & methods:**
- First line: one-sentence summary of what the function does.
- Then `@param name - description` for each parameter.
- Then `@returns` with a short description if the function returns non-void.

**Classes, interfaces, type aliases, enums:**
- Summarize the purpose and role of the type.
- Prefer describing intent over implementation details.

**Mode behavior:**
- `update_missing`: Do not rewrite existing comments unless they are obviously
  placeholder (e.g., `TODO`, `fix`, `FIXME`, `@todo`).
- `update_all`: Improve unclear comments but preserve any explicit developer
  notes or warnings.

**Example:**
```typescript
/** Loads a user by id from the primary data store.
 * @param id - Unique identifier of the user.
 * @returns The user if found, otherwise null.
 */
async function getUserById(id: string): Promise<User | null> {
  // ...
}
```

**Overloaded/union-heavy functions:**
Describe the general behavior rather than each possible overload or union
variant.

### Rust Rules

**Comment style**: Use `///` triple-slash line comments for item docs. Keep
lines around 80 characters.

**Structure:**
- First line: brief summary sentence.
- Blank `///` line, then details or examples as needed.
- For fallible functions, add a `# Errors` section if the error conditions are
  clear from the signature.
- Refer to types with backticks: `` `SomeType` ``.

**Scope**: Only document public API by default (`pub fn`, `pub struct`,
`pub enum`, `pub trait`, pub methods on pub types).

**Mode behavior:**
- `update_missing`: Only add docs to items without existing `///` comments.
- `update_all`: Refine awkward wording but preserve explicit notes like
  `# Panics` or `# Safety`.

**Example:**
```rust
/// Calculates the checksum for the given buffer.
///
/// # Errors
///
/// Returns an error if the buffer length exceeds the supported maximum.
pub fn checksum(buf: &[u8]) -> Result<u32, ChecksumError> {
    // ...
}
```

## Selection Behavior

- If `selection_range` is provided: Only consider declarations that **start**
  within the selected line range. Do not modify docs for items outside the
  selection.
- If a declaration spans multiple lines and the selection includes its start
  line, treat the entire declaration as in-scope.
- If `selection_range` is omitted: Apply the chosen mode to the entire file,
  respecting `public_only`.

## Edge Cases

- **Generic names**: If a symbol name is extremely generic (e.g., `doStuff`,
  `handle`), use surrounding code and types to infer a better description, but
  stay conservative.
- **Insufficient context**: If there isn't enough information to write a
  meaningful description, use a neutral description like "Performs the
  operation for this type" rather than fabricating details.
- **Rust generics**: Do not over-specify type parameters. Describe the concept
  and constraints at a high level.
- **Selection mid-declaration**: If the selection start line falls inside a
  multi-line declaration, still treat the entire declaration as in scope.

## Output

Return these three values:

| Field | Type | Description |
|---|---|---|
| `updated_text` | string | Full file text with updated doc comments |
| `summary` | string | 1-3 sentence summary of what was documented |
| `touched_symbols` | string[] | Names of functions/types that had docs added or updated |
