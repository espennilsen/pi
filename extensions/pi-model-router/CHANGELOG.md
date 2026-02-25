# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Initial scaffold with extension architecture
- LLM-based prompt classification (any OpenAI-compatible API)
- Three-tier routing: simple → Haiku, medium → Sonnet, complex → Opus
- Static override rules (regex pattern matching on prompts)
- In-memory classification cache with configurable TTL
- Mode-aware behavior: auto-switch in subprocesses, configurable in TUI (off/suggest/auto)
- Shim pattern: zero changes to pi-cron, pi-heartbeat, or pi-subagent
- Graceful degradation: falls back to default tier on classifier failure
