/// transcribe-apple — macOS speech-to-text via SFSpeechRecognizer.
///
/// Usage: transcribe-apple <audio-file> [language-code]
/// Prints transcribed text to stdout. Exits 1 on error (message to stderr).

import Foundation
import Speech

guard CommandLine.arguments.count >= 2 else {
    FileHandle.standardError.write("Usage: transcribe-apple <audio-file> [language-code]\n".data(using: .utf8)!)
    exit(1)
}

let filePath = CommandLine.arguments[1]
let languageCode = CommandLine.arguments.count >= 3 ? CommandLine.arguments[2] : "en-US"

// Normalize short language codes (e.g. "en" → "en-US", "no" → "nb-NO")
func normalizeLocale(_ code: String) -> Locale {
    let mapping: [String: String] = [
        "en": "en-US", "no": "nb-NO", "nb": "nb-NO", "nn": "nn-NO",
        "sv": "sv-SE", "da": "da-DK", "de": "de-DE", "fr": "fr-FR",
        "es": "es-ES", "it": "it-IT", "pt": "pt-BR", "ja": "ja-JP",
        "ko": "ko-KR", "zh": "zh-CN", "ru": "ru-RU", "ar": "ar-SA",
        "hi": "hi-IN", "pl": "pl-PL", "nl": "nl-NL", "fi": "fi-FI",
    ]
    let resolved = mapping[code] ?? code
    return Locale(identifier: resolved)
}

let locale = normalizeLocale(languageCode)
let fileURL = URL(fileURLWithPath: filePath)

guard FileManager.default.fileExists(atPath: filePath) else {
    FileHandle.standardError.write("File not found: \(filePath)\n".data(using: .utf8)!)
    exit(1)
}

guard let recognizer = SFSpeechRecognizer(locale: locale) else {
    FileHandle.standardError.write("Speech recognizer not available for locale: \(locale.identifier)\n".data(using: .utf8)!)
    exit(1)
}

guard recognizer.isAvailable else {
    FileHandle.standardError.write("Speech recognizer not available (offline model may need download)\n".data(using: .utf8)!)
    exit(1)
}

// Request authorization (needed even for on-device recognition)
let authSemaphore = DispatchSemaphore(value: 0)
var authStatus: SFSpeechRecognizerAuthorizationStatus = .notDetermined

SFSpeechRecognizer.requestAuthorization { status in
    authStatus = status
    authSemaphore.signal()
}
authSemaphore.wait()

guard authStatus == .authorized else {
    FileHandle.standardError.write("Speech recognition not authorized (status: \(authStatus.rawValue)). Grant access in System Settings > Privacy > Speech Recognition.\n".data(using: .utf8)!)
    exit(1)
}

// Perform recognition
let request = SFSpeechURLRecognitionRequest(url: fileURL)
// Try on-device first, but don't require it (fallback to online)
request.requiresOnDeviceRecognition = false
request.shouldReportPartialResults = false

var transcribedText: String?
var recognitionError: Error?
var done = false

let task = recognizer.recognitionTask(with: request) { result, error in
    if let error = error {
        recognitionError = error
        done = true
        CFRunLoopStop(CFRunLoopGetMain())
        return
    }
    
    if let result = result, result.isFinal {
        transcribedText = result.bestTranscription.formattedString
        done = true
        CFRunLoopStop(CFRunLoopGetMain())
    }
}

// Run the main RunLoop so callbacks can be delivered, with a 60s timeout.
// SFSpeechRecognizer dispatches results via the RunLoop — blocking with a
// semaphore starves it and prevents callbacks from firing.
let deadline = Date(timeIntervalSinceNow: 60)
while !done && Date() < deadline {
    RunLoop.current.run(mode: .default, before: min(deadline, Date(timeIntervalSinceNow: 0.5)))
}

if !done {
    FileHandle.standardError.write("Transcription timed out after 60 seconds\n".data(using: .utf8)!)
    task.cancel()
    exit(1)
}

if let error = recognitionError {
    FileHandle.standardError.write("Recognition error: \(error.localizedDescription)\n".data(using: .utf8)!)
    exit(1)
}

guard let text = transcribedText, !text.isEmpty else {
    FileHandle.standardError.write("No speech detected in audio\n".data(using: .utf8)!)
    exit(1)
}

print(text)
