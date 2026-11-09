#!/usr/bin/env node
// Used by the installer when it finds an earlier version of the widget in a
// different folder: moves the references that pointed to the old folder.
//
//   node migrate.js "C:\path\to\old\folder"

const fs = require('fs');
const os = require('os');
const path = require('path');

const oldDir = process.argv[2] || '';
const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const writer = path.join(__dirname, 'statusline-writer.js').replace(/\\/g, '/');

// 1) Claude Code status line (if it was connected to the old version)
try {
  const text = fs.readFileSync(SETTINGS, 'utf8').replace(/^\uFEFF/, '');
  const j = JSON.parse(text);
  const cmd = j && j.statusLine && j.statusLine.command;
  if (typeof cmd === 'string' && cmd.includes('statusline-writer.js') && !cmd.includes(writer)) {
    fs.copyFileSync(SETTINGS, SETTINGS + '.bak-widget-migration');
    j.statusLine.command = `node "${writer}"`;
    fs.writeFileSync(SETTINGS, JSON.stringify(j, null, 2) + '\n');
    console.log('  Claude Code status line now points to the new folder.');
  }
} catch (_) {
  /* no Claude Code settings to update */
}

// 2) Your own status line, if the old version had kept it
if (oldDir) {
  const from = path.join(oldDir, 'statusline-wrap.txt');
  const to = path.join(__dirname, 'statusline-wrap.txt');
  try {
    if (fs.existsSync(from) && !fs.existsSync(to)) {
      fs.copyFileSync(from, to);
      console.log('  Kept your own status line.');
    }
  } catch (_) {
    /* not critical */
  }
}
