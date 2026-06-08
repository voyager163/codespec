'use strict';
// Scaffold a real, minimal Power Apps Code App (Vite + React 19 + TypeScript + React
// Router) into an empty workspace, so "Create a new app" lands the maker in a project
// the code engine can immediately build into. The router.tsx is authored in the exact
// shape codegen.wireRouter recognizes, so the first generated screen wires itself in.
//
// Everything here is real, installable source — no placeholders. It is intentionally
// small (no Tailwind/shadcn) so it installs fast and compiles anywhere; generated
// screens use plain className strings that degrade gracefully without a CSS framework.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function isScaffolded(root) {
  return fs.existsSync(path.join(root, 'src', 'main.tsx')) && fs.existsSync(path.join(root, 'package.json'));
}

function write(root, rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

// Files for a minimal but real code app. Returns the relative paths written.
function scaffold(root, opts = {}) {
  if (isScaffolded(root)) return { created: false, already: true, files: [] };
  const name = (opts.name || path.basename(root) || 'my-app').replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'my-app';
  const pkgName = name.toLowerCase().replace(/\s+/g, '-');

  const files = {
    'package.json': JSON.stringify(
      {
        name: pkgName,
        private: true,
        version: '0.1.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'tsc --noEmit && vite build', preview: 'vite preview' },
        dependencies: {
          react: '^19.0.0',
          'react-dom': '^19.0.0',
          'react-router-dom': '^6.26.0',
        },
        devDependencies: {
          '@types/react': '^19.0.0',
          '@types/react-dom': '^19.0.0',
          '@vitejs/plugin-react': '^4.3.0',
          typescript: '^5.5.0',
          vite: '^5.4.0',
        },
      },
      null,
      2,
    ) + '\n',

    'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,

    'vite.config.ts': `import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath, URL } from "node:url"

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
})
`,

    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          useDefineForClassFields: true,
          lib: ['ES2020', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          skipLibCheck: true,
          moduleResolution: 'bundler',
          allowImportingTsExtensions: false,
          resolveJsonModule: true,
          isolatedModules: true,
          noEmit: true,
          jsx: 'react-jsx',
          strict: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noFallthroughCasesInSwitch: true,
          baseUrl: '.',
          paths: { '@/*': ['src/*'] },
        },
        include: ['src'],
      },
      null,
      2,
    ) + '\n',

    'src/main.tsx': `import React from "react"
import ReactDOM from "react-dom/client"
import { RouterProvider } from "react-router-dom"
import { router } from "@/router"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
`,

    // IMPORTANT: this shape is what codegen.wireRouter matches — keep createBrowserRouter
    // and a `children: [` array so new screens can be inserted automatically.
    'src/router.tsx': `import { createBrowserRouter } from "react-router-dom"
import Layout from "@/pages/_layout"
import HomePage from "@/pages/home"

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [{ index: true, element: <HomePage /> }],
  },
])
`,

    'src/pages/_layout.tsx': `import { Outlet, Link } from "react-router-dom"

export default function Layout() {
  return (
    <div>
      <nav className="p-4 border-b flex gap-4 text-sm">
        <Link to="/">Home</Link>
      </nav>
      <Outlet />
    </div>
  )
}
`,

    'src/pages/home.tsx': `export default function HomePage() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">${esc(name)}</h1>
      <p className="text-sm text-muted-foreground">
        Your app is ready. Describe a screen in chat and it will be built and added here.
      </p>
    </div>
  )
}
`,

    // Plans (.powercodex/plans/*.html + *.json) ARE committed so the agent can refer
    // back and learn across machines; only the live view, screenshots, and browser
    // profiles stay local.
    '.gitignore': 'node_modules\ndist\n.powercodex/live\n.powercodex/plans/shots/\n.profiles\n',
  };

  const written = [];
  for (const [rel, content] of Object.entries(files)) {
    write(root, rel, content);
    written.push(rel);
  }
  return { created: true, already: false, name, files: written };
}

// Kick off `npm install` in the background; resolves when it finishes. The build gate
// (codegen.verifyBuild) reports "deps not installed" until this completes, so callers
// can proceed and the first build simply verifies once deps are present.
function installDeps(root, { onLine } = {}) {
  return new Promise((resolve) => {
    if (fs.existsSync(path.join(root, 'node_modules'))) return resolve({ ran: false, already: true });
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    let child;
    try {
      child = spawn(npm, ['install', '--no-audit', '--no-fund'], { cwd: root, shell: process.platform === 'win32' });
    } catch (e) {
      return resolve({ ran: false, error: e.message });
    }
    const relay = (b) => {
      if (onLine) String(b).split('\n').forEach((l) => l.trim() && onLine(l.trim()));
    };
    if (child.stdout) child.stdout.on('data', relay);
    if (child.stderr) child.stderr.on('data', relay);
    child.on('error', (e) => resolve({ ran: false, error: e.message }));
    child.on('close', (code) => resolve({ ran: true, code, ok: code === 0 }));
  });
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[<>{}]/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = { scaffold, isScaffolded, installDeps };
