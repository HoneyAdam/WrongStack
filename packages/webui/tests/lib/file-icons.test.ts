/**
 * Tests for src/lib/file-icons.ts — file icon and color by extension/name.
 * Pure functions with no external dependencies.
 */

import { describe, expect, it } from 'vitest';
import { fileIconColor, fileIcon } from '../../src/lib/file-icons';
import * as Lucide from 'lucide-react';

describe('fileIconColor', () => {
  describe('directories', () => {
    it('returns orange for .git', () => {
      expect(fileIconColor('.git', true)).toContain('orange');
    });

    it('returns red for node_modules', () => {
      expect(fileIconColor('node_modules', true)).toContain('red');
    });

    it('returns amber for src', () => {
      expect(fileIconColor('src', true)).toContain('amber');
    });

    it('returns amber for lib', () => {
      expect(fileIconColor('lib', true)).toContain('amber');
    });

    it('returns amber for packages', () => {
      expect(fileIconColor('packages', true)).toContain('amber');
    });

    it('returns emerald for tests', () => {
      expect(fileIconColor('tests', true)).toContain('emerald');
    });

    it('returns emerald for __tests__', () => {
      expect(fileIconColor('__tests__', true)).toContain('emerald');
    });

    it('returns muted for dist', () => {
      expect(fileIconColor('dist', true)).toContain('muted');
    });

    it('returns amber for an unknown directory', () => {
      expect(fileIconColor('random_dir', true)).toContain('amber');
    });
  });

  describe('file extensions', () => {
    it('returns blue for .ts and .tsx', () => {
      expect(fileIconColor('file.ts', false)).toContain('blue');
      expect(fileIconColor('file.tsx', false)).toContain('blue');
    });

    it('returns blue for .js and .jsx', () => {
      expect(fileIconColor('file.js', false)).toContain('blue');
      expect(fileIconColor('file.jsx', false)).toContain('blue');
    });

    it('returns blue for .mjs and .cjs', () => {
      expect(fileIconColor('file.mjs', false)).toContain('blue');
      expect(fileIconColor('file.cjs', false)).toContain('blue');
    });

    it('returns amber for .json and .lock', () => {
      expect(fileIconColor('package.json', false)).toContain('amber');
      expect(fileIconColor('package-lock.json', false)).toContain('amber');
    });

    it('returns teal for .css and .scss', () => {
      expect(fileIconColor('style.css', false)).toContain('teal');
      expect(fileIconColor('style.scss', false)).toContain('teal');
    });

    it('returns rose for .html and .xml', () => {
      expect(fileIconColor('index.html', false)).toContain('rose');
      expect(fileIconColor('data.xml', false)).toContain('rose');
    });

    it('returns violet for .md and .mdx', () => {
      expect(fileIconColor('readme.md', false)).toContain('violet');
      expect(fileIconColor('doc.mdx', false)).toContain('violet');
    });

    it('returns emerald for .yml, .yaml, .toml, .env', () => {
      expect(fileIconColor('config.yml', false)).toContain('emerald');
      expect(fileIconColor('config.yaml', false)).toContain('emerald');
      expect(fileIconColor('config.toml', false)).toContain('emerald');
      expect(fileIconColor('.env', false)).toContain('emerald');
    });

    it('returns orange for shell scripts', () => {
      expect(fileIconColor('script.sh', false)).toContain('orange');
      expect(fileIconColor('script.bash', false)).toContain('orange');
      expect(fileIconColor('script.ps1', false)).toContain('orange');
    });

    it('returns cyan for Python files', () => {
      expect(fileIconColor('main.py', false)).toContain('cyan');
      expect(fileIconColor('types.pyi', false)).toContain('cyan');
    });

    it('returns orange for Rust', () => {
      expect(fileIconColor('main.rs', false)).toContain('orange');
    });

    it('returns sky for Go', () => {
      expect(fileIconColor('main.go', false)).toContain('sky');
    });

    it('returns red for Ruby', () => {
      expect(fileIconColor('main.rb', false)).toContain('red');
    });

    it('returns slate for C/C++', () => {
      expect(fileIconColor('main.c', false)).toContain('slate');
      expect(fileIconColor('main.hpp', false)).toContain('slate');
    });

    it('returns purple for images', () => {
      expect(fileIconColor('image.png', false)).toContain('purple');
      expect(fileIconColor('image.jpg', false)).toContain('purple');
      expect(fileIconColor('image.gif', false)).toContain('purple');
    });

    it('returns muted for config files', () => {
      expect(fileIconColor('.gitignore', false)).toContain('muted');
      expect(fileIconColor('.editorconfig', false)).toContain('muted');
    });

    it('returns default muted for unknown extension', () => {
      expect(fileIconColor('file.xyz', false)).toBe('text-muted-foreground');
    });

    it('handles files without extension', () => {
      expect(fileIconColor('Makefile', false)).toBe('text-muted-foreground');
    });
  });
});

describe('fileIcon', () => {
  it('returns FileCode icon for .ts', () => {
    const Icon = fileIcon('file.ts');
    expect(Icon).toBe(Lucide.FileCode);
  });

  it('returns FileCode icon for .py', () => {
    const Icon = fileIcon('file.py');
    expect(Icon).toBe(Lucide.FileCode);
  });

  it('returns FileJson icon for .json', () => {
    const Icon = fileIcon('file.json');
    expect(Icon).toBe(Lucide.FileJson);
  });

  it('returns FileLock icon for .lock', () => {
    const Icon = fileIcon('package-lock.json.lock');
    expect(Icon).toBe(Lucide.FileLock);
  });

  it('returns FileImage icon for .png', () => {
    const Icon = fileIcon('image.png');
    expect(Icon).toBe(Lucide.FileImage);
  });

  it('returns FileType icon for .html', () => {
    const Icon = fileIcon('index.html');
    expect(Icon).toBe(Lucide.FileType);
  });

  it('returns FileCog for .toml', () => {
    const Icon = fileIcon('config.toml');
    expect(Icon).toBe(Lucide.FileCog);
  });

  it('returns default File icon for unknown extension', () => {
    const Icon = fileIcon('file.xyz');
    expect(Icon).toBe(Lucide.File);
  });

  it('returns default File icon for file without extension', () => {
    const Icon = fileIcon('Makefile');
    expect(Icon).toBe(Lucide.File);
  });
});
