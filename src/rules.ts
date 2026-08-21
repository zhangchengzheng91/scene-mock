import fs from 'fs';
import path from 'path';

const RULES_FILE = path.join(__dirname, '../rules.txt');

/** @returns true if the file was written */
export function writePluginRules(text: string): boolean {
  try {
    if (fs.existsSync(RULES_FILE) && fs.readFileSync(RULES_FILE, 'utf8') === text) {
      return false;
    }
  } catch {
    // fall through and write
  }
  fs.writeFileSync(RULES_FILE, text, 'utf8');
  return true;
}
