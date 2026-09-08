#!/usr/bin/env node
// Alias entry point. The real launcher is the `demobite` package; this file
// exists so the same tool answers to more than one spelling. Everything,
// including subcommands (login, mcp, logout, retake), passes straight through.
import "demobite/launcher/index.mjs";
