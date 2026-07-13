#!/usr/bin/env node

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'powercodex-'));
const projectName = 'verify-app';
const projectPath = path.join(tempRoot, projectName);

try {
  run('node', [path.join(repoRoot, 'bin', 'create-powercodex.js'), projectName, '--skip-install', '--skip-git'], tempRoot);

  assertFile(path.join(projectPath, 'package.json'));
  assertFile(path.join(projectPath, 'openspec', 'config.yaml'));
  assertDirectory(path.join(projectPath, '.github', 'prompts'));
  assertDirectory(path.join(projectPath, '.github', 'skills'));
  assertFile(path.join(projectPath, '.github', 'workflows', 'ghas.yml'));
  assertFile(path.join(projectPath, '.github', 'workflows', 'quality.yml'));
  assertFile(path.join(projectPath, 'playwright.config.ts'));
  assertFile(path.join(projectPath, 'prettier.config.js'));
  assertFile(path.join(projectPath, '.prettierignore'));
  assertFile(path.join(projectPath, 'scripts', 'check-changed-file-coverage.js'));
  assertFile(path.join(projectPath, 'src', 'test', 'setup.ts'));
  assertFile(path.join(projectPath, 'src', 'App.test.tsx'));
  assertFile(path.join(projectPath, 'src', 'telemetry', 'app-telemetry.ts'));
  assertFile(path.join(projectPath, 'src', 'telemetry', 'app-telemetry.test.ts'));
  assertFile(path.join(projectPath, 'e2e', 'home.spec.ts'));

  const promptsDir = path.join(projectPath, '.github', 'prompts');
  const promptCount = fs.readdirSync(promptsDir).filter((entry) => entry.endsWith('.prompt.md')).length;
  const skillCount = countDirectories(path.join(projectPath, '.github', 'skills'));

  const sourcePromptsDir = path.join(repoRoot, 'templates', 'github', 'prompts');
  const expectedPromptCount = fs.readdirSync(sourcePromptsDir).filter((entry) => entry.endsWith('.prompt.md')).length;
  const expectedSkillCount = countDirectories(path.join(repoRoot, 'templates', 'github', 'skills'));

  if (promptCount !== expectedPromptCount) {
    throw new Error(`Expected ${expectedPromptCount} OPSX prompt files (per templates/github/prompts), found ${promptCount}.`);
  }

  assertFile(path.join(promptsDir, '_html-artifact.md'));
  assertFile(path.join(promptsDir, 'opsx-reflect.prompt.md'));

  // PowerCodex Lifecycle tool + automation scaffold ship in generated projects.
  assertFile(path.join(projectPath, 'tools', 'lifecycle', 'bin', 'powercodex-lifecycle.js'));
  assertFile(path.join(projectPath, 'tools', 'lifecycle', 'package.json'));
  assertFile(path.join(projectPath, 'tools', 'lifecycle', 'assets', 'dashboard.html'));
  assertDirectory(path.join(projectPath, 'automation', 'shared'));
  assertDirectory(path.join(projectPath, 'automation', 'build-executor'));
  assertDirectory(path.join(projectPath, 'automation', 'e2e-suite'));

  if (skillCount !== expectedSkillCount) {
    throw new Error(`Expected ${expectedSkillCount} OpenSpec skill folders (per templates/github/skills), found ${skillCount}.`);
  }

  const expectedConfig = fs.readFileSync(path.join(repoRoot, 'templates', 'openspec', 'config.yaml'), 'utf8');
  const actualConfig = fs.readFileSync(path.join(projectPath, 'openspec', 'config.yaml'), 'utf8');

  if (actualConfig !== expectedConfig) {
    throw new Error('Generated openspec/config.yaml does not match the fixed template config.');
  }

  if (!actualConfig.includes('Vite + React 19 (TypeScript)')) {
    throw new Error('Generated openspec/config.yaml does not describe React 19.');
  }

  const generatedPackage = readJson(path.join(projectPath, 'package.json'));

  assertPackageScript(generatedPackage, 'lint');
  assertPackageScript(generatedPackage, 'test');
  assertPackageScript(generatedPackage, 'test:run');
  assertPackageScript(generatedPackage, 'test:coverage');
  assertPackageScript(generatedPackage, 'coverage:changed');
  assertPackageScript(generatedPackage, 'e2e');
  assertPackageScript(generatedPackage, 'format');
  assertPackageScript(generatedPackage, 'format:check');
  assertPackageScript(generatedPackage, 'lifecycle:serve');
  assertPackageScript(generatedPackage, 'lifecycle:selftest');

  assertPackageScriptValue(generatedPackage, 'lint', /--max-warnings 0/);
  assertPackageScriptValue(generatedPackage, 'test:coverage', /vitest run --coverage/);
  assertPackageScriptValue(generatedPackage, 'coverage:changed', /check-changed-file-coverage\.js/);

  assertPackageDependency(generatedPackage, 'dependencies', 'react', /^\^19\./);
  assertPackageDependency(generatedPackage, 'dependencies', 'react-dom', /^\^19\./);
  assertPackageDependency(generatedPackage, 'devDependencies', 'vitest');
  assertPackageDependency(generatedPackage, 'devDependencies', 'jsdom');
  assertPackageDependency(generatedPackage, 'devDependencies', '@testing-library/react');
  assertPackageDependency(generatedPackage, 'devDependencies', '@testing-library/jest-dom');
  assertPackageDependency(generatedPackage, 'devDependencies', '@testing-library/user-event');
  assertPackageDependency(generatedPackage, 'devDependencies', '@playwright/test');
  assertPackageDependency(generatedPackage, 'devDependencies', '@vitest/coverage-v8', /^\^4\./);
  assertPackageDependency(generatedPackage, 'devDependencies', 'prettier');

  console.log('Generated project verification passed.');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function run(command, args, cwd) {
  const result = childProcess.spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function assertFile(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`Expected file missing: ${filePath}`);
  }
}

function assertDirectory(directoryPath) {
  if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    throw new Error(`Expected directory missing: ${directoryPath}`);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assertPackageScript(packageJson, scriptName) {
  if (!packageJson.scripts || !packageJson.scripts[scriptName]) {
    throw new Error(`Expected package script missing: ${scriptName}`);
  }
}

function assertPackageScriptValue(packageJson, scriptName, valuePattern) {
  const value = packageJson.scripts?.[scriptName];

  if (!valuePattern.test(value)) {
    throw new Error(`Expected package script ${scriptName} to match ${valuePattern}, found ${value}`);
  }
}

function assertPackageDependency(packageJson, section, dependencyName, versionPattern) {
  const version = packageJson[section]?.[dependencyName];

  if (!version) {
    throw new Error(`Expected package ${section} missing: ${dependencyName}`);
  }

  if (versionPattern && !versionPattern.test(version)) {
    throw new Error(`Expected package ${dependencyName} version to match ${versionPattern}, found ${version}`);
  }
}

function countFiles(directoryPath) {
  return fs.readdirSync(directoryPath)
    .filter((entry) => fs.statSync(path.join(directoryPath, entry)).isFile())
    .length;
}

function countDirectories(directoryPath) {
  return fs.readdirSync(directoryPath)
    .filter((entry) => fs.statSync(path.join(directoryPath, entry)).isDirectory())
    .length;
}