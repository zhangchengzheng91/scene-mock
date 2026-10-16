import fs from 'fs';
import path from 'path';

function rulesFile(): string {
  return process.env.SCENE_MOCK_RULES_FILE || path.join(__dirname, '../rules.txt');
}

/** @returns true if the file was written */
export function writePluginRules(text: string): boolean {
  const file = rulesFile();
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) {
      return false;
    }
  } catch {
    // fall through and write
  }
  fs.writeFileSync(file, text, 'utf8');
  return true;
}
