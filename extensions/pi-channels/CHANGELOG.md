# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-04-26

### Added

- **File upload support (GitHub #153):** Incoming files of any type (video, audio, binary, etc.) can be saved to temp and passed to the LLM as attachments with `fileUpload.enabled: true` in adapter config
- **Bidirectional file transfer:** New `send_file` action on the `notify` tool lets the LLM send local files back to Telegram chats
- **`ChannelMessage.filePath/fileName/caption`:** Outgoing messages can now include a file attachment instead of text
- **`ChannelAdapter.sendFile()`:** Adapters can implement file sending (Telegram supports sendDocument/sendPhoto/sendAudio/sendVideo)
- **`channel:send_file` event:** Event bus API for file sends from other extensions
- **`FileUploadConfig` type:** Configurable `maxSize` (default 50MB) for file uploads per adapter
- **Video support:** Telegram adapter handles video messages when `fileUpload` is enabled
- **Smart fallback:** Audio/voice transcription falls back to file upload when transcription fails and `fileUpload` is enabled
- **`IncomingAttachment.type: "file"`:** New attachment type for generic file uploads

### Changed

- Photos use `fileUpload.maxSize` when `fileUpload` is enabled (previously hard-coded 1MB limit)
- Documents use `fileUpload.maxSize` when `fileUpload` is enabled (previously hard-coded 1MB limit)
- Unsupported file types now suggest enabling `fileUpload` instead of just rejecting
- Audio/voice messages without transcription configured now suggest enabling `fileUpload` as alternative
- `notify` tool description updated to include `send_file` action
- Event bus command handlers now forward the `source` field, allowing web/mobile clients to route `command_result` events to the originating UI

## [0.2.0] - 2026-03-06

### Added

- OpenAI transcription now automatically uses pi's built-in OpenAI authentication if available (no need for explicit `apiKey` in config)
- Users who have run `/login openai` can enable transcription without additional configuration
- Sync bot commands with Telegram on startup (populates the `/command` menu in Telegram)
- Slack and Telegram adapters now validate that `text` is present before sending

### Changed

- **BREAKING:** `env:VAR_NAME` substitution in settings is no longer supported. Set secret values (tokens, API keys) directly in `settings.json` instead of using `"env:..."` references.
- Adapter factories are now async to support modelRegistry API key resolution
- Transcription providers use static `create()` factory methods instead of constructors

### Fixed

- Fix broken Telegram voice transcription: convert Ogg Opus to M4A via ffmpeg before passing to Apple SFSpeechRecognizer (which has poor Ogg Opus support)
- Use RunLoop instead of DispatchSemaphore in Swift transcriber — fixes callback delivery hang where recognition results were never received
- Renamed Swift helper to `transcribe-apple-v2.swift` to force recompilation after the RunLoop fix
- Relaxed `requiresOnDeviceRecognition` to `false` — allows fallback to online recognition when on-device model is unavailable

## [0.1.1] - 2026-02-19 (7442720)

### Added

- Support custom JSON payloads in webhook adapter via `notify` tool
- Add explicit webhook payload controls: `payloadMode` (`envelope`/`raw`), `rawBody`, and per-message webhook overrides (`method`, `contentType`)

### Fixed

- Guard `notify` JSON parsing and return graceful `Invalid JSON` errors instead of throwing
- Remove metadata side-channel payload switching (`metadata["json"]`) in favor of typed fields
- Allow raw JSON sends without injecting empty `text` into outgoing messages
- Omit request body for webhook `GET`/`HEAD` requests to avoid undici runtime errors
- Omit `Content-Type` for bodyless `GET`/`HEAD` webhook requests
- Prevent silent raw payload drops by rejecting `GET`/`HEAD` requests that include `json/rawBody`
- Add `HEAD` method support to the `notify` tool
- Document `contentType` precedence over `headers["Content-Type"]` for webhook config

## [0.1.0] - 2026-02-17 (7839f93)

### Added

- Initial release.