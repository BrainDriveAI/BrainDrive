# BrainDrive Starter Pack Update Manifest

## Version 26.4.14
### AI Briefing
These changes introduce explicit update decision state so migrations can remain cumulative while respecting prior user decisions.

### Item: Seed update decision state
- action: write system/updates/applied.json -> system/updates/applied.json

### Item: Seed cumulative update manifest
- action: write system/updates/manifest.md -> system/updates/manifest.md

## Version 26.4.15
### AI Briefing
These changes keep update planning aligned to the shipped starter-pack baseline and current system metadata.

### Item: Align version metadata with starter-pack baseline
- action: write system/version.json -> system/version.json
