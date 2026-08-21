import fs from 'fs';
import path from 'path';

export function toPrettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function atomicWrite(file: string, content: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, content, 'utf8');
  await fs.promises.rename(tmp, file);
}

export async function readText(file: string): Promise<string> {
  return fs.promises.readFile(file, 'utf8');
}

export function exists(file: string): boolean {
  try {
    fs.accessSync(file);
    return true;
  } catch {
    return false;
  }
}

export async function rmrf(target: string): Promise<void> {
  await fs.promises.rm(target, { recursive: true, force: true });
}

export function previewJson(value: unknown, max = 200): string {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text == null) {
    return 'null';
  }
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
