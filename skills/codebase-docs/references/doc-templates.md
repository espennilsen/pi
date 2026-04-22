# Documentation Templates Reference

Use these templates as starting points for each documentation file. Adapt sections as needed — not every project will need every section, and some projects will need additional sections. The key is consistency across the doc set.

---

## OVERVIEW.md Template

````markdown
# [Project Name]

> Last updated: YYYY-MM-DD

[2-3 sentence description of what this project does and who it's for.]

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | e.g., TypeScript 5.x |
| Framework | e.g., Next.js 14 |
| Database | e.g., PostgreSQL 16 via Prisma |
| Auth | e.g., NextAuth.js with JWT |
| Deployment | e.g., Vercel + AWS RDS |

## Architecture Style

[One paragraph describing the overall architecture: monolith, microservices, serverless, etc. Mention key architectural decisions and why they were made if apparent from the code.]

## Key Concepts

[Define the 3-7 most important domain concepts an agent needs to understand. These are the nouns and verbs of the system.]

- **[Concept]**: [Definition and role in the system]

## Entry Points

| Entry Point | File | Purpose |
|------------|------|---------|
| Main | `src/index.ts` | Application bootstrap |
| API Routes | `src/routes/` | HTTP endpoint definitions |
| CLI | `src/cli.ts` | Command-line interface |

## Changes Log

- YYYY-MM-DD: Initial documentation generated
````

---

## STRUCTURE.md Template

````markdown
# Project Structure

> Last updated: YYYY-MM-DD

[1-2 sentences about how the project is organized.]

## Directory Tree

[Generate an annotated tree. Group by responsibility, not alphabetically. Use comments to explain non-obvious directories.]

```
project-root/
├── src/                    # Application source code
│   ├── api/                # API route handlers
│   │   ├── routes/         # Route definitions
│   │   └── middleware/     # Request/response middleware
│   ├── core/               # Business logic (framework-agnostic)
│   │   ├── services/       # Service layer
│   │   └── models/         # Domain models / types
│   ├── data/               # Data access layer
│   │   ├── repositories/   # Database queries
│   │   └── migrations/     # Schema migrations
│   └── utils/              # Shared utilities
├── tests/                  # Test files mirroring src/ structure
├── config/                 # Configuration files
├── scripts/                # Build/deploy/maintenance scripts
├── docs/                   # This documentation
└── [other top-level files] # package.json, tsconfig, etc.
```

## Key Files

[List the 5-15 most important files an agent should know about.]

| File | Role |
|------|------|
| `src/index.ts` | Application entry point, bootstraps server |
| `src/core/services/auth.ts` | Authentication logic, token validation |

## Module Boundaries

[Describe which directories are allowed to import from which. This helps agents understand dependency direction.]

- `api/` → imports from `core/` and `utils/`, never from `data/` directly
- `core/` → imports from `data/` and `utils/`, never from `api/`
- `data/` → imports from `utils/` only
- `utils/` → no internal imports (leaf module)

## Changes Log

- YYYY-MM-DD: Initial documentation generated
````

---

## ARCHITECTURE.md Template

````markdown
# Architecture

> Last updated: YYYY-MM-DD

[2-3 sentence summary of the architectural approach.]

## System Overview

[High-level description of how the system works. Describe the flow from user input to output.]

## Component Map

[List the major components/modules and their single-sentence responsibilities.]

| Component | Location | Responsibility |
|-----------|----------|---------------|
| Router | `src/api/router.ts` | Maps HTTP requests to handlers |
| AuthService | `src/core/services/auth.ts` | User authentication and authorization |

## Data Flow

[Describe the primary data flow(s) through the system. Use arrows for directionality.]

### [Primary Flow Name, e.g., "User Request Lifecycle"]

```
Client Request
  → API Router (src/api/router.ts)
    → Auth Middleware (src/api/middleware/auth.ts)
      → Controller (src/api/controllers/*.ts)
        → Service Layer (src/core/services/*.ts)
          → Repository (src/data/repositories/*.ts)
            → Database
          ← Returns data
        ← Transforms to response
      ← Sends HTTP response
```

### [Secondary flows as needed]

## Key Abstractions

[Describe the interfaces, base classes, or patterns that tie the system together.]

### [Abstraction Name]

- **What**: [What it is]
- **Where**: [File path]
- **Used by**: [Which modules depend on it]
- **Why it matters**: [Why an agent should care]

## External Dependencies

[List external services, APIs, or systems this project integrates with.]

| Dependency | Purpose | Integration Point |
|-----------|---------|-------------------|
| Stripe API | Payment processing | `src/core/services/payments.ts` |

## Architectural Decisions

[Note any non-obvious architectural choices visible in the code, if detectable.]

- **[Decision]**: [Rationale or observation]

## Changes Log

- YYYY-MM-DD: Initial documentation generated
````

---

## DATA_MODEL.md Template

````markdown
# Data Model

> Last updated: YYYY-MM-DD

[1-2 sentences about the data layer: what ORM/database is used, where schemas are defined.]

## Entities

### [Entity Name]

- **Location**: `src/models/user.ts` or `prisma/schema.prisma`
- **Purpose**: [What this entity represents]
- **Key fields**:
  | Field | Type | Description |
  |-------|------|-------------|
  | id | UUID | Primary key |
  | email | string | Unique, used for auth |

### [Next entity...]

## Relationships

[Describe how entities relate to each other.]

- User → has many → Posts (one-to-many via `user_id` FK)
- Post → has many → Tags (many-to-many via `post_tags` join table)

## Key Types / Interfaces

[For non-database projects, document the important TypeScript interfaces, Python dataclasses, Rust structs, etc.]

### [Type Name]

- **Location**: `src/types/config.ts`
- **Used by**: [Where this type appears]
- **Shape**: [Brief description or simplified type signature]

## Changes Log

- YYYY-MM-DD: Initial documentation generated
````

---

## INDEX.md Template

````markdown
# Documentation Index

> Last updated: YYYY-MM-DD

This directory contains AI-readable documentation for [Project Name]. Start with OVERVIEW.md for a high-level understanding, then navigate to specific docs as needed.

## Reading Order for New Agents

1. **[OVERVIEW.md](OVERVIEW.md)** — What this project is and does
2. **[STRUCTURE.md](STRUCTURE.md)** — Where things live in the codebase
3. **[ARCHITECTURE.md](ARCHITECTURE.md)** — How components connect and data flows

## All Documentation

| Document | Description |
|----------|-------------|
| [OVERVIEW.md](OVERVIEW.md) | Project purpose, tech stack, key concepts |
| [STRUCTURE.md](STRUCTURE.md) | Directory layout and key files |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Component relationships and data flow |
| [DATA_MODEL.md](DATA_MODEL.md) | Database schema and entity relationships |
| [API.md](API.md) | Endpoints, auth, request/response shapes |
| [CONFIGURATION.md](CONFIGURATION.md) | Environment variables and config knobs |
| [PATTERNS.md](PATTERNS.md) | Recurring design patterns and conventions |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Build, deploy, and infrastructure |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Local setup, testing, contributing |
| [GLOSSARY.md](GLOSSARY.md) | Domain-specific terminology |

[Remove rows for docs that weren't generated.]

## Changes Log

- YYYY-MM-DD: Initial documentation generated
````

---

## API.md Template

````markdown
# API Documentation

> Last updated: YYYY-MM-DD

[1-2 sentences: what kind of API, base URL pattern, general auth approach.]

## Authentication

[How API authentication works — tokens, API keys, sessions, etc. Where the auth logic lives.]

## Endpoints Overview

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | /api/users | `src/api/routes/users.ts` | List users |
| POST | /api/users | `src/api/routes/users.ts` | Create user |

## Endpoint Details

### [GROUP: e.g., Users]

#### `METHOD /path`

- **Handler**: `src/api/routes/file.ts:functionName`
- **Auth**: Required / Public
- **Request**: [Key params, body shape]
- **Response**: [Key fields in response]
- **Notes**: [Any non-obvious behavior]

## Error Handling

[How errors are structured and returned across the API.]

## Changes Log

- YYYY-MM-DD: Initial documentation generated
````

---

## CONFIGURATION.md Template

````markdown
# Configuration

> Last updated: YYYY-MM-DD

[Where configuration is loaded and how it's structured.]

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| DATABASE_URL | Yes | — | PostgreSQL connection string |
| JWT_SECRET | Yes | — | Secret for token signing |
| PORT | No | 3000 | Server listen port |

## Config Files

| File | Purpose |
|------|---------|
| `.env` | Local environment variables (not committed) |
| `config/default.ts` | Default configuration values |

## Feature Flags

[If applicable — list feature flags, where they're checked, and their defaults.]

## Changes Log

- YYYY-MM-DD: Initial documentation generated
````

---

## PATTERNS.md Template

````markdown
# Patterns & Conventions

> Last updated: YYYY-MM-DD

[1-2 sentences about the project's approach to code organization.]

## Naming Conventions

[File naming, variable naming, class naming patterns used in the project.]

## Error Handling

[How errors are created, propagated, and handled. Reference specific error classes or utilities.]

## Logging

[Logging approach — library used, log levels, where logs go.]

## Testing Patterns

[Test organization, mocking approach, test utilities available.]

## Common Patterns

### [Pattern Name]

- **What**: [Description]
- **Where**: [Example file paths]
- **Why**: [Purpose of this pattern]

## Changes Log

- YYYY-MM-DD: Initial documentation generated
````

---

## GLOSSARY.md Template

````markdown
# Glossary

> Last updated: YYYY-MM-DD

Domain-specific and project-specific terms used in this codebase.

| Term | Definition | Used In |
|------|-----------|---------|
| [Term] | [What it means in this project's context] | `src/core/services/term.ts` |

## Changes Log

- YYYY-MM-DD: Initial documentation generated
````

---

## DEPLOYMENT.md Template

````markdown
# Deployment

> Last updated: YYYY-MM-DD

[1-2 sentences about the deployment approach: where it's hosted, how it's built, key environments.]

## Build Process

[How the project is built from source to deployable artifact.]

## Environments

| Environment | URL / Endpoint | Purpose |
|-------------|---------------|---------|
| Development | `http://localhost:3000` | Local iteration |
| Staging | [URL] | Pre-production validation |
| Production | [URL] | Live traffic |

## CI/CD Pipeline

[Description of the automated pipeline, where config lives, and what triggers deploys.]

## Infrastructure

[High-level description of cloud resources, containers, databases, CDNs, etc.]

## Rollback Strategy

[How to revert a bad deployment.]

## Changes Log

- YYYY-MM-DD: Initial documentation generated
````

---

## DEVELOPMENT.md Template

````markdown
# Development

> Last updated: YYYY-MM-DD

[1-2 sentences about the local development experience.]

## Prerequisites

[List all tools, languages, and versions needed before `npm install` / `cargo build` / etc.]

## Local Setup

[Step-by-step instructions to get the project running locally.]

## Testing

[How to run the test suite, what frameworks are used, and any test configuration.]

## Debugging

[Common techniques, log locations, and how to attach a debugger.]

## Contributing

[Guidelines for PRs, code style, and commit conventions if applicable.]

## Changes Log

- YYYY-MM-DD: Initial documentation generated
````
