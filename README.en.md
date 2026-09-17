# Shiju · Local English vocabulary learning

## Download

**[⬇ Windows installer](https://github.com/Protritium/Shiju/releases/latest/download/Shiju-Windows-Setup.exe)** · **[⬇ Android APK](https://github.com/Protritium/Shiju/releases/latest/download/Shiju-Android.apk)**

[All releases](https://github.com/Protritium/Shiju/releases) · [简体中文](README.md) · **English**

> Links work after the first Release is published. “Source code” ZIP files are not installers.

Developed by **神奇的氕氚 (Protritium)**. Follow [the developer](https://github.com/Protritium) and submit feedback through [GitHub Issues](https://github.com/Protritium/Shiju/issues). The application interface is Chinese; this document is an English user guide.

Shiju helps you recall vocabulary through short phrases and full sentences. It includes junior-high, high-school, CET-6 and postgraduate vocabulary, mistake review, dictionary lookup, system speech and manual progress synchronization. Local study does not require Python or a cloud account.

## Windows installation

1. Download `Shiju-Windows-Setup.exe` above.
2. Double-click, follow Next / Install, and open the Shiju desktop shortcut.
3. A local service opens the learning interface in your browser. This is expected. Keep the background control window running while studying.

The release preparation does not add a Windows digital signature. If Windows displays an unknown publisher warning, verify the download source. Developer attribution is not certificate signing.

## Android installation

1. Download `Shiju-Android.apk` on an Android 7.0+ ARM64 phone.
2. Open the APK from Downloads or your file manager.
3. If prompted, allow that browser or file manager to install unknown apps, then install.
4. Open 拾句. iPhones and 32-bit-only devices are not supported by this APK.

Back up before upgrading. Android updates require a compatible package name, signing certificate and version. If installation reports a signature conflict, do not immediately uninstall: uninstalling usually deletes local progress.

## First study session

Create a local account, choose a vocabulary book and a daily target, then enter the Chinese meaning of the highlighted word. Reveal the explanation and select recall success or failure. Use 错题本 for mistake review and 查词 for dictionary lookup. New users default to high-school vocabulary and full sentences.

On Windows, F2 reads the current phrase/sentence and F3 opens lookup. Android uses on-screen buttons. Speech depends on an installed system English TTS voice. In mobile focus mode, tap 退出专注 to return to the full interface.

## Transfer progress

Open 数据同步 (Data synchronization), export a JSON backup, transfer it to the other device and import it there. Synchronization is manual, not cloud-based. The 1.9 series supports JSON v2 merges including deletion records and review events. Backups do not include passwords. Keep a backup from each device before merging.

## Troubleshooting

- Browser interface on Windows: normal; the application serves it locally.
- No speech: check volume and installed English TTS voices.
- Progress missing on another device: export and import a backup manually.
- APK will not install: check Android version, ARM64 support, space and compatibility with the existing signature; back up before removing an older installation.
- Data location: Windows uses `%LOCALAPPDATA%\Shiju`; Android uses private application storage. Use the built-in export function for backups.

## Feedback and releases

Use [Issues](https://github.com/Protritium/Shiju/issues) to report your platform, version, reproduction steps and screenshots. Do not share passwords, private account files or signing keys.

This repository includes both platform sources: `windows-package-experiment` and `android-package-experiment`, alongside documentation for existing user-supplied installers. See [source/build notes](SOURCE.md). The source is the current local snapshot; exact reproducibility of the supplied binaries has not been established. Private learning data, signing keys, corpora and model files are excluded. See [release notes](RELEASE_NOTES.md) for hashes and [publishing instructions](PUBLISH.md) for maintainers.
