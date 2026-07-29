# pi-tts

Text-to-speech extension for [pi](https://github.com/espennilsen/pi). Generates WAV audio from text via a local TTS server.

## Setup

### Prerequisites

A TTS server running on your LAN (e.g. [Coqui TTS](https://github.com/coqui-ai/TTS)) that accepts:

```
POST /tts
Content-Type: application/json

{
  "text": "Hello world",
  "language_id": "en",
  "voice_sample_path": "/opt/tts/voices/espen.wav"
}
```

And returns a WAV binary response (`audio/wav`).

### Installation

The extension lives in `~/.pi/agent/extensions/pi-tts/`. It's auto-discovered by pi.

### Configuration (optional)

Add to your `settings.json` to override defaults:

```json
{
  "pi-tts": {
    "baseUrl": "http://192.168.0.27:8001",
    "timeoutMs": 30000
  }
}
```

### Adding Voices

Edit `voices.ts` to register new voice samples:

```typescript
export const VOICE_MAP: Record<string, string> = {
  espen: "/opt/tts/voices/espen.wav",
  sarah: "/opt/tts/voices/sarah.wav",  // add new voices here
};
```

## Usage

### LLM Tool: `generate_tts`

The assistant can call this tool directly:

```
generate_tts(text="Hello, this is a test.", voice_id="espen")
```

**Parameters:**

| Param         | Type   | Required | Default | Description                        |
|---------------|--------|----------|---------|------------------------------------|
| `text`        | string | ✓        |         | The text to speak                  |
| `language_id` | string |          | `"en"`  | Language code (e.g. "en", "no")    |
| `voice_id`    | string |          | —       | Logical voice name (e.g. "espen")  |

**Success response:**

```json
{
  "file_path": "/tmp/tts-a3f7c1d2-4e5b-4a89-b1c6-8d2e9f0a1b3c.wav",
  "mime_type": "audio/wav",
  "size_bytes": 52480
}
```

**Error response:**

```json
{
  "error": true,
  "status": 500,
  "message": "TTS backend error",
  "details": "up to 2KB of response text"
}
```

### TUI Command: `/tts`

Quick speech from the pi TUI:

```
/tts Hello world
/tts --voice espen This is Espen speaking
```

### Playing the Audio

After receiving the file path, play it however you like:

```bash
# macOS
afplay /tmp/tts-<uuid>.wav

# Linux
aplay /tmp/tts-<uuid>.wav

# Or send it to a streaming endpoint
curl -X POST http://your-player/upload -F "file=@/tmp/tts-<uuid>.wav"
```

## License

MIT