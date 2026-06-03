#!/usr/bin/env node

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const commandName = 'codespec';
const minNodeVersion = [20, 19, 0];
const openspecPackage = '@fission-ai/openspec@latest';

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const projectName = options.projectName || await promptForProjectName();
  validateProjectName(projectName);

  const targetPath = path.resolve(process.cwd(), projectName);
  const templateRoot = path.resolve(__dirname, '..', 'templates');

  printHeader(projectName);

  await runStep('Check Node.js', () => checkNodeVersion());
  await runStep('Check npm', () => requireCommand('npm'));
  await runStep('Check git', () => requireCommand('git'));
  await runStep('Check OpenSpec', () => ensureOpenSpec());
  await runStep('Validate target folder', () => ensureTargetAvailable(targetPath));
  await runStep('Copy starter template', () => copyStarter(templateRoot, targetPath, projectName));
  await runStep('Copy OpenSpec OPSX assets', () => copyGithubOverlay(templateRoot, targetPath));
  await runStep('Install npm dependencies', () => installDependencies(targetPath, options));
  await runStep('Initialize OpenSpec', () => setupOpenSpec(targetPath));
  await runStep('Apply Power Apps OpenSpec config', () => applyOpenSpecConfig(templateRoot, targetPath));
  await runStep('Finalize OPSX assets', () => copyGithubOverlay(templateRoot, targetPath));
  await runStep('Initialize git repository', () => initializeGit(targetPath, options));

  printNextSteps(projectName);
}

function parseArgs(args) {
  const options = {
    help: false,
    projectName: '',
    skipInstall: false,
    skipGit: false,
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--skip-install') {
      options.skipInstall = true;
    } else if (arg === '--skip-git') {
      options.skipGit = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!options.projectName) {
      options.projectName = arg.trim();
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: ${commandName} [project-name] [options]\n`);
  console.log('Install: npm install -g @voyager163/codespec@latest');
  console.log('Run without installing: npx @voyager163/codespec [project-name] [options]\n');
  console.log('Options:');
  console.log('  --skip-install   Create the project without running npm install');
  console.log('  --skip-git       Create the project without running git init');
  console.log('  -h, --help       Show this help message');
}

function promptForProjectName() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('Project name: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function validateProjectName(projectName) {
  if (!projectName) {
    throw new Error('Project name is required.');
  }

  if (projectName.includes('/') || projectName.includes('\\')) {
    throw new Error('Project name must be a folder name, not a path.');
  }

  if (projectName === '.' || projectName === '..') {
    throw new Error('Project name cannot be . or ...');
  }
}

function printHeader(projectName) {
  console.log('Specify Project Setup');
  console.log(`Creating new project: ${projectName}`);
  console.log('');
}

async function runStep(label, task) {
  console.log(`[run] ${label}`);

  try {
    const result = await task();
    if (result === 'skipped') {
      console.log(`[skip] ${label}`);
    } else {
      console.log(`[ok] ${label}`);
    }
  } catch (error) {
    console.error(`[fail] ${label}`);
    throw error;
  }
}

function checkNodeVersion() {
  const actual = process.versions.node.split('.').map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < minNodeVersion.length; index += 1) {
    if (actual[index] > minNodeVersion[index]) {
      return;
    }

    if (actual[index] < minNodeVersion[index]) {
      throw new Error(`Node.js ${minNodeVersion.join('.')} or newer is required. Current version: ${process.versions.node}`);
    }
  }
}

function requireCommand(command) {
  if (!commandExists(command)) {
    throw new Error(`Required command not found: ${command}`);
  }
}

function commandExists(command) {
  const result = childProcess.spawnSync(command, ['--version'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });

  return !result.error && result.status === 0;
}

function ensureOpenSpec() {
  if (commandExists('openspec')) {
    return;
  }

  console.log(`OpenSpec not found. Installing ${openspecPackage} globally...`);
  runCommand('npm', ['install', '-g', openspecPackage]);

  if (!commandExists('openspec')) {
    throw new Error(`OpenSpec installation finished but openspec is still unavailable. Try manually running: npm install -g ${openspecPackage}`);
  }
}

function ensureTargetAvailable(targetPath) {
  if (fs.existsSync(targetPath)) {
    throw new Error(`Target folder already exists: ${targetPath}`);
  }
}

function copyStarter(templateRoot, targetPath, projectName) {
  const starterPath = path.join(templateRoot, 'starter');
  assertDirectory(starterPath, 'Starter template is missing.');

  fs.cpSync(starterPath, targetPath, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });

  updatePackageName(targetPath, projectName);
}

function updatePackageName(targetPath, projectName) {
  const packagePath = path.join(targetPath, 'package.json');
  if (!fs.existsSync(packagePath)) {
    return;
  }

  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  packageJson.name = normalizePackageName(projectName);
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}${os.EOL}`);
}

function normalizePackageName(projectName) {
  const normalized = projectName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+/, '')
    .replace(/[._-]+$/, '')
    .replace(/-{2,}/g, '-');

  return normalized || 'codespec-app';
}

function copyGithubOverlay(templateRoot, targetPath) {
  const githubTemplatePath = path.join(templateRoot, 'github');
  assertDirectory(githubTemplatePath, 'GitHub OpenSpec template overlay is missing.');

  const targetGithubPath = path.join(targetPath, '.github');
  fs.mkdirSync(targetGithubPath, { recursive: true });
  fs.cpSync(githubTemplatePath, targetGithubPath, {
    recursive: true,
    force: true,
  });
}

function installDependencies(targetPath, options) {
  if (options.skipInstall) {
    return 'skipped';
  }

  runCommand('npm', ['install'], { cwd: targetPath });
}

function setupOpenSpec(targetPath) {
  const openspecPath = path.join(targetPath, 'openspec');
  if (fs.existsSync(openspecPath)) {
    runCommand('openspec', ['update', '--force'], { cwd: targetPath });
    return;
  }

  runCommand('openspec', ['init', '--tools', 'github-copilot', '--force'], { cwd: targetPath });
}

function applyOpenSpecConfig(templateRoot, targetPath) {
  const configTemplatePath = path.join(templateRoot, 'openspec', 'config.yaml');
  const targetConfigPath = path.join(targetPath, 'openspec', 'config.yaml');
  assertFile(configTemplatePath, 'OpenSpec config template is missing.');

  fs.mkdirSync(path.dirname(targetConfigPath), { recursive: true });
  fs.copyFileSync(configTemplatePath, targetConfigPath);
}

function initializeGit(targetPath, options) {
  if (options.skipGit) {
    return 'skipped';
  }

  runCommand('git', ['init'], { cwd: targetPath });
}

function runCommand(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
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

function assertDirectory(directoryPath, message) {
  if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    throw new Error(message);
  }
}

function assertFile(filePath, message) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(message);
  }
}

function printNextSteps(projectName) {
  console.log('');
  console.log('Project ready.');
  console.log('');
  console.log('Next steps');
  console.log(`1. cd ${projectName}`);
  console.log('2. code .');
  console.log('3. pac code init --environment <environmentId> --displayName <appDisplayName>');
  console.log('4. Use /opsx:explore, /opsx:propose, and /opsx:apply with GitHub Copilot');
  console.log('5. npm run dev');
}

main().catch((error) => {
  console.error('');
  console.error(error.message);
  process.exitCode = 1;
});