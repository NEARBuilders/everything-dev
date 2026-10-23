---
"everything-dev": patch
---

fix(deploy): resolve the authored config before pipelined uploads start — a folder-form plugin ui upload starting mid-build read a config binding first initialized after the build phase and died with "Cannot access 'rawConfig' before initialization" after all workspaces built successfully
