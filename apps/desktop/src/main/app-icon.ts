import * as fs from 'node:fs/promises';
import { nativeImage, type NativeImage } from 'electron';

async function readIcon(relativePath: string): Promise<NativeImage | undefined> {
  try {
    const iconPath = new URL(relativePath, import.meta.url).pathname;
    await fs.stat(iconPath);
    const icon = nativeImage.createFromPath(iconPath);
    return icon.isEmpty() ? undefined : icon;
  } catch {
    return undefined;
  }
}

/** Resolves the best supported desktop icon without making application boot depend on it. */
export async function loadDesktopAppIcon(): Promise<NativeImage | undefined> {
  if (process.platform !== 'darwin') return readIcon('../../assets/icon.svg');
  return (await readIcon('../../assets/icon.png')) ?? readIcon('../../assets/icon.icns');
}
