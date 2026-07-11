import { packageNames, processPlan, unavailable } from '../profile-helpers.js';
import type { LanguageProfile } from '../types.js';

const IGNORES = Object.freeze([
  '.git',
  '.wrongstack',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'coverage',
]);

function pythonProfile(): LanguageProfile {
  return {
    id: 'python',
    displayName: 'Python',
    extensions: Object.freeze(['.py', '.pyi']),
    lspLanguageIds: Object.freeze(['python']),
    detectors: Object.freeze([
      { kind: 'config', filename: 'pyproject.toml', weight: 90 },
      { kind: 'config', filename: 'setup.py', weight: 70 },
      { kind: 'config', filename: 'setup.cfg', weight: 60 },
      { kind: 'manifest', filename: 'requirements.txt', weight: 55 },
      { kind: 'manifest', filename: 'Pipfile', weight: 50 },
      { kind: 'lockfile', filename: 'poetry.lock', weight: 30 },
      { kind: 'lockfile', filename: 'Pipfile.lock', weight: 30 },
      { kind: 'lockfile', filename: 'uv.lock', weight: 30 },
    ]),
    ignoredDirectories: IGNORES,
    packageManagers: Object.freeze(['pip', 'poetry', 'pipenv', 'uv']),
    executables: Object.freeze(['python', 'python3', 'ruff', 'black', 'pytest', 'mypy', 'pyright']),
    operations: Object.freeze({
      syntax: async (ctx) => {
        const py = ctx.options.target ? 'python3' : 'python3';
        return ctx.options.target
          ? processPlan(ctx, 'syntax', py, ['-m', 'py_compile', ctx.options.target], {
              parser: 'python',
              reason: 'Compile the target file to check for syntax errors.',
            })
          : unavailable(ctx, 'syntax', 'Python syntax check requires an explicit target file.');
      },
      semantic: async (ctx) =>
        processPlan(ctx, 'semantic', 'mypy', ['.', '--no-error-summary'], {
          parser: 'mypy',
          reason: 'Run mypy type checking on the workspace.',
          executesProjectCode: true,
        }),
      lint: async (ctx) =>
        processPlan(ctx, 'lint', 'ruff', ['check', '.'], {
          parser: 'ruff',
          reason: 'Run the Ruff linter on the workspace.',
        }),
      'format-check': async (ctx) =>
        processPlan(ctx, 'format-check', 'ruff', ['format', '--check', '.'], {
          parser: 'ruff',
          reason: 'Check Python formatting without writing files.',
        }),
      'format-write': async (ctx) =>
        processPlan(ctx, 'format-write', 'ruff', ['format', '.'], {
          parser: 'ruff',
          reason: 'Format Python source files.',
          mutating: true,
        }),
      test: async (ctx) =>
        processPlan(
          ctx,
          'test',
          'pytest',
          [...(ctx.options.filter ? ['-k', ctx.options.filter] : []), '.'],
          {
            parser: 'pytest',
            reason: ctx.options.filter ? 'Run filtered Python tests.' : 'Run all Python tests.',
            mutating: true,
            executesProjectCode: true,
          },
        ),
      build: async (ctx) =>
        unavailable(ctx, 'build', 'Python is interpreted; use semantic or test instead.'),
      'debug-compile': async (ctx) =>
        processPlan(ctx, 'debug-compile', 'mypy', ['.', '--no-error-summary'], {
          parser: 'mypy',
          reason: 'Collect mypy type diagnostics.',
          executesProjectCode: true,
        }),
      'package-install': async (ctx) =>
        processPlan(ctx, 'package-install', 'pip', ['install', '--no-cache-dir'], {
          parser: 'package-text',
          reason: 'Install dependencies from requirements.',
          mutating: true,
          network: true,
        }),
      'package-add': async (ctx) => {
        const names = packageNames(ctx);
        return names.length === 0
          ? unavailable(ctx, 'package-add', 'At least one package name is required.')
          : processPlan(ctx, 'package-add', 'pip', ['install', ...names], {
              parser: 'package-text',
              reason: 'Install specified Python packages.',
              mutating: true,
              network: true,
            });
      },
      'package-audit': async (ctx) =>
        processPlan(ctx, 'package-audit', 'pip', ['audit'], {
          parser: 'pip-audit',
          reason: 'Audit Python dependencies for vulnerabilities.',
          network: true,
        }),
    }),
  };
}

function javaProfile(): LanguageProfile {
  return {
    id: 'java',
    displayName: 'Java / Kotlin',
    extensions: Object.freeze(['.java', '.kt', '.kts', '.scala']),
    lspLanguageIds: Object.freeze(['java', 'kotlin']),
    detectors: Object.freeze([
      { kind: 'manifest', filename: 'pom.xml', weight: 90 },
      { kind: 'manifest', filename: 'build.gradle', weight: 85 },
      { kind: 'manifest', filename: 'build.gradle.kts', weight: 85 },
      { kind: 'manifest', filename: 'settings.gradle', weight: 50 },
      { kind: 'lockfile', filename: 'gradle.lockfile', weight: 30 },
    ]),
    ignoredDirectories: IGNORES,
    packageManagers: Object.freeze(['maven', 'gradle']),
    executables: Object.freeze(['mvn', 'gradle', 'java', 'kotlinc']),
    operations: Object.freeze({
      semantic: async (ctx) =>
        processPlan(ctx, 'semantic', 'mvn', ['compile', '-q'], {
          parser: 'maven',
          reason: 'Compile the Maven project.',
          mutating: true,
          executesProjectCode: true,
        }),
      lint: async (ctx) =>
        unavailable(
          ctx,
          'lint',
          'Java linting requires a configured checkstyle or spotbugs plugin.',
        ),
      'format-check': async (ctx) =>
        unavailable(
          ctx,
          'format-check',
          'Java formatting check requires a configured spotless or google-java-format plugin.',
        ),
      test: async (ctx) =>
        processPlan(ctx, 'test', 'mvn', ['test', '-q'], {
          parser: 'maven',
          reason: 'Run Maven tests.',
          mutating: true,
          executesProjectCode: true,
        }),
      build: async (ctx) =>
        processPlan(ctx, 'build', 'mvn', ['package', '-q', '-DskipTests'], {
          parser: 'maven',
          reason: 'Build the Maven project, skipping tests.',
          mutating: true,
          executesProjectCode: true,
        }),
      'package-install': async (ctx) =>
        unavailable(
          ctx,
          'package-install',
          'JVM dependency installation happens through build or dependency:get.',
        ),
      'package-add': async (ctx) => {
        const names = packageNames(ctx);
        return names.length === 0
          ? unavailable(ctx, 'package-add', 'At least one dependency coordinate is required.')
          : processPlan(ctx, 'package-add', 'mvn', ['dependency:get', `-Dartifact=${names[0]}`], {
              parser: 'maven',
              reason: 'Resolve and fetch a Maven dependency.',
              mutating: true,
              network: true,
            });
      },
    }),
  };
}

function rubyProfile(): LanguageProfile {
  return {
    id: 'ruby',
    displayName: 'Ruby',
    extensions: Object.freeze(['.rb']),
    lspLanguageIds: Object.freeze(['ruby']),
    detectors: Object.freeze([
      { kind: 'manifest', filename: 'Gemfile', weight: 90 },
      { kind: 'config', filename: '.ruby-version', weight: 40 },
      { kind: 'lockfile', filename: 'Gemfile.lock', weight: 30 },
    ]),
    ignoredDirectories: IGNORES,
    packageManagers: Object.freeze(['gem', 'bundler']),
    executables: Object.freeze(['ruby', 'gem', 'bundle', 'rubocop', 'rspec']),
    operations: Object.freeze({
      syntax: async (ctx) =>
        ctx.options.target
          ? processPlan(ctx, 'syntax', 'ruby', ['-c', ctx.options.target], {
              parser: 'ruby',
              reason: 'Check the target Ruby file for syntax errors.',
            })
          : unavailable(ctx, 'syntax', 'Ruby syntax check requires an explicit target file.'),
      lint: async (ctx) =>
        processPlan(ctx, 'lint', 'rubocop', ['--format=json'], {
          parser: 'rubocop',
          reason: 'Run RuboCop linter.',
          executesProjectCode: true,
        }),
      'format-write': async (ctx) =>
        processPlan(ctx, 'format-write', 'rubocop', ['--auto-correct'], {
          parser: 'rubocop',
          reason: 'Auto-correct RuboCop violations.',
          mutating: true,
          executesProjectCode: true,
        }),
      test: async (ctx) =>
        processPlan(ctx, 'test', 'rspec', [], {
          parser: 'rspec',
          reason: 'Run the RSpec test suite.',
          mutating: true,
          executesProjectCode: true,
        }),
      'package-install': async (ctx) =>
        processPlan(ctx, 'package-install', 'bundle', ['install'], {
          parser: 'package-text',
          reason: 'Install Ruby gem dependencies.',
          mutating: true,
          network: true,
          executesProjectCode: true,
        }),
      'package-add': async (ctx) => {
        const names = packageNames(ctx);
        return names.length === 0
          ? unavailable(ctx, 'package-add', 'At least one gem name is required.')
          : processPlan(ctx, 'package-add', 'gem', ['install', ...names], {
              parser: 'package-text',
              reason: 'Install specified Ruby gems.',
              mutating: true,
              network: true,
            });
      },
      'package-audit': async (ctx) =>
        processPlan(ctx, 'package-audit', 'bundle', ['audit', '--format=json'], {
          parser: 'bundler-audit',
          reason: 'Audit Ruby gems for vulnerabilities.',
          network: true,
        }),
    }),
  };
}

function cProfile(): LanguageProfile {
  return {
    id: 'c',
    displayName: 'C / C++',
    extensions: Object.freeze(['.c', '.h']),
    lspLanguageIds: Object.freeze(['c']),
    detectors: Object.freeze([
      { kind: 'manifest', filename: 'CMakeLists.txt', weight: 85 },
      { kind: 'manifest', filename: 'Makefile', weight: 60 },
      { kind: 'config', suffix: '.cmake', weight: 50 },
    ]),
    ignoredDirectories: IGNORES,
    packageManagers: Object.freeze([]),
    executables: Object.freeze(['cc', 'gcc', 'clang', 'cmake', 'make']),
    operations: Object.freeze({
      semantic: async (ctx) =>
        processPlan(ctx, 'semantic', 'cmake', ['--build', '.', '--target', 'all'], {
          parser: 'cmake',
          reason: 'Build C project to collect compiler diagnostics.',
          mutating: true,
          executesProjectCode: true,
        }),
      test: async (ctx) =>
        unavailable(
          ctx,
          'test',
          'C test execution requires a configured test runner (ctest, etc.).',
        ),
      build: async (ctx) =>
        processPlan(ctx, 'build', 'cmake', ['--build', '.'], {
          parser: 'cmake',
          reason: 'Build the C project.',
          mutating: true,
          executesProjectCode: true,
        }),
    }),
  };
}

function cppProfile(): LanguageProfile {
  return {
    ...cProfile(),
    id: 'cpp',
    displayName: 'C++',
    extensions: Object.freeze(['.cpp', '.cc', '.cxx', '.hpp', '.hxx']),
    lspLanguageIds: Object.freeze(['cpp']),
    detectors: Object.freeze([
      { kind: 'manifest', filename: 'CMakeLists.txt', weight: 85 },
      { kind: 'manifest', filename: 'Makefile', weight: 50 },
    ]),
    executables: Object.freeze(['c++', 'g++', 'clang++', 'cmake', 'make']),
  };
}

function swiftProfile(): LanguageProfile {
  return {
    id: 'swift',
    displayName: 'Swift',
    extensions: Object.freeze(['.swift']),
    lspLanguageIds: Object.freeze(['swift']),
    detectors: Object.freeze([{ kind: 'manifest', filename: 'Package.swift', weight: 90 }]),
    ignoredDirectories: IGNORES,
    packageManagers: Object.freeze(['swift']),
    executables: Object.freeze(['swift', 'swiftc']),
    operations: Object.freeze({
      semantic: async (ctx) =>
        processPlan(ctx, 'semantic', 'swift', ['build'], {
          parser: 'swift',
          reason: 'Build Swift package to collect compiler diagnostics.',
          mutating: true,
          executesProjectCode: true,
        }),
      test: async (ctx) =>
        processPlan(ctx, 'test', 'swift', ['test'], {
          parser: 'swift-test',
          reason: 'Run Swift tests.',
          mutating: true,
          executesProjectCode: true,
        }),
      build: async (ctx) =>
        processPlan(ctx, 'build', 'swift', ['build', '-c', 'release'], {
          parser: 'swift',
          reason: 'Build the Swift package in release mode.',
          mutating: true,
          executesProjectCode: true,
        }),
    }),
  };
}

function dartProfile(): LanguageProfile {
  return {
    id: 'dart',
    displayName: 'Dart / Flutter',
    extensions: Object.freeze(['.dart']),
    lspLanguageIds: Object.freeze(['dart']),
    detectors: Object.freeze([
      { kind: 'manifest', filename: 'pubspec.yaml', weight: 90 },
      { kind: 'lockfile', filename: 'pubspec.lock', weight: 30 },
    ]),
    ignoredDirectories: IGNORES,
    packageManagers: Object.freeze(['pub']),
    executables: Object.freeze(['dart', 'flutter']),
    operations: Object.freeze({
      semantic: async (ctx) =>
        processPlan(ctx, 'semantic', 'dart', ['analyze'], {
          parser: 'dart-analyze',
          reason: 'Run Dart static analysis.',
        }),
      'format-check': async (ctx) =>
        processPlan(
          ctx,
          'format-check',
          'dart',
          ['format', '--output=none', '--set-exit-if-changed', '.'],
          {
            parser: 'dart-format',
            reason: 'Check Dart formatting without writing files.',
          },
        ),
      'format-write': async (ctx) =>
        processPlan(ctx, 'format-write', 'dart', ['format', '.'], {
          parser: 'dart-format',
          reason: 'Format Dart source files.',
          mutating: true,
        }),
      test: async (ctx) =>
        processPlan(ctx, 'test', 'dart', ['test'], {
          parser: 'dart-test',
          reason: 'Run Dart tests.',
          mutating: true,
          executesProjectCode: true,
        }),
      'package-install': async (ctx) =>
        processPlan(ctx, 'package-install', 'dart', ['pub', 'get'], {
          parser: 'package-text',
          reason: 'Fetch Dart package dependencies.',
          mutating: true,
          network: true,
        }),
      'package-outdated': async (ctx) =>
        processPlan(ctx, 'package-outdated', 'dart', ['pub', 'outdated'], {
          parser: 'dart-outdated',
          reason: 'Check for outdated Dart packages.',
          network: true,
        }),
    }),
  };
}

function elixirProfile(): LanguageProfile {
  return {
    id: 'elixir',
    displayName: 'Elixir',
    extensions: Object.freeze(['.ex', '.exs']),
    lspLanguageIds: Object.freeze(['elixir']),
    detectors: Object.freeze([
      { kind: 'manifest', filename: 'mix.exs', weight: 90 },
      { kind: 'lockfile', filename: 'mix.lock', weight: 30 },
    ]),
    ignoredDirectories: IGNORES,
    packageManagers: Object.freeze(['mix']),
    executables: Object.freeze(['mix', 'elixir']),
    operations: Object.freeze({
      semantic: async (ctx) =>
        unavailable(ctx, 'semantic', 'Elixir compilation is handled by the build operation.'),
      lint: async (ctx) => unavailable(ctx, 'lint', 'Elixir linting requires the credo package.'),
      test: async (ctx) =>
        processPlan(ctx, 'test', 'mix', ['test'], {
          parser: 'mix-test',
          reason: 'Run ExUnit tests.',
          mutating: true,
          executesProjectCode: true,
        }),
      build: async (ctx) =>
        processPlan(ctx, 'build', 'mix', ['compile'], {
          parser: 'mix',
          reason: 'Compile the Mix project.',
          mutating: true,
          executesProjectCode: true,
        }),
      'package-install': async (ctx) =>
        processPlan(ctx, 'package-install', 'mix', ['deps.get'], {
          parser: 'package-text',
          reason: 'Fetch Elixir dependencies.',
          mutating: true,
          network: true,
        }),
    }),
  };
}

function shellProfile(): LanguageProfile {
  return {
    id: 'shell',
    displayName: 'Shell',
    extensions: Object.freeze(['.sh', '.bash']),
    lspLanguageIds: Object.freeze(['shellscript']),
    detectors: Object.freeze([{ kind: 'config', filename: 'ShellCheckrc', weight: 50 }]),
    ignoredDirectories: IGNORES,
    packageManagers: Object.freeze([]),
    executables: Object.freeze(['bash', 'sh', 'shellcheck', 'shfmt']),
    operations: Object.freeze({
      syntax: async (ctx) =>
        ctx.options.target
          ? processPlan(ctx, 'syntax', 'bash', ['-n', ctx.options.target], {
              parser: 'shell',
              reason: 'Check the shell script for syntax errors.',
            })
          : unavailable(ctx, 'syntax', 'Shell syntax check requires an explicit target file.'),
      lint: async (ctx) =>
        ctx.options.target
          ? processPlan(ctx, 'lint', 'shellcheck', ['--format=json', ctx.options.target], {
              parser: 'shellcheck',
              reason: 'Run ShellCheck on the target script.',
            })
          : unavailable(ctx, 'lint', 'Shell linting requires an explicit target file.'),
      'format-check': async (ctx) =>
        ctx.options.target
          ? processPlan(ctx, 'format-check', 'shfmt', ['-d', ctx.options.target], {
              parser: 'shell',
              reason: 'Check shell formatting without writing.',
            })
          : unavailable(
              ctx,
              'format-check',
              'Shell formatting check requires an explicit target file.',
            ),
      'format-write': async (ctx) =>
        ctx.options.target
          ? processPlan(ctx, 'format-write', 'shfmt', ['-w', ctx.options.target], {
              parser: 'shell',
              reason: 'Format the shell script.',
              mutating: true,
            })
          : unavailable(ctx, 'format-write', 'Shell formatting requires an explicit target file.'),
    }),
  };
}

export const ADDITIONAL_LANGUAGE_PROFILES: readonly LanguageProfile[] = Object.freeze([
  pythonProfile(),
  javaProfile(),
  rubyProfile(),
  cProfile(),
  cppProfile(),
  swiftProfile(),
  dartProfile(),
  elixirProfile(),
  shellProfile(),
]);
