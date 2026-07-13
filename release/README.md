# Recruitment Assistant Release

This directory contains the Windows x64 portable release builder.

## Build

Run from the repository root:

```powershell
npm run build:release
```

The builder creates:

- `release/recruitment-assistant-win-x64/`
- `release/recruitment-assistant-win-x64-vX.Y.Z.zip`
- `release/recruitment-assistant-win-x64-vX.Y.Z.sha256`

The generated package contains:

- a production server and web interface;
- a portable Node.js Windows x64 runtime;
- production Node dependencies;
- the unpacked Chrome extension;
- start and stop scripts;
- empty `data` and `logs` directories.

The current development database is never copied into the release.

## Requirements

- Build host: Windows x64, Node.js 20, npm, internet access for the first build.
- Target host: Windows 10/11 x64 and Chrome.

Generated release directories, archives, checksums, and the download cache are
