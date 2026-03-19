#!/usr/bin/env node
import { execSync, spawnSync } from 'child_process';
import { main as installMain } from './install-idb';
function which(cmd) {
    try {
        // Prefer POSIX `command -v` which can resolve shell builtins. Use spawnSync
        // to avoid shell interpolation and injection risks. Fall back to `which`.
        const res = spawnSync('command', ['-v', cmd], { stdio: ['ignore', 'pipe', 'ignore'] });
        if (res && res.status === 0 && res.stdout) return res.stdout.toString().trim();
        return execSync(`which ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    }
    catch {
        return null;
    }
}
function print(...args) {
    console.log(...args);
}
async function runInstaller() {
    try {
        // prefer invoking the TS script via npx/tsx to ensure environment
        const runner = which('npx') ? 'npx' : which('tsx') ? 'tsx' : null;
        if (runner) {
            const args = runner === 'npx' ? ['tsx', './scripts/install-idb.ts'] : ['./scripts/install-idb.ts'];
            const res = spawnSync(runner, args, { stdio: 'inherit' });
            return typeof res.status === 'number' ? res.status === 0 : false;
        }
        // fallback: attempt to import and run the installer directly (may rely on ts-node/tsx)
        try {
            // call the exported main; it returns a promise
            await installMain();
            return true;
        }
        catch {
            return false;
        }
    }
    catch (e) {
        console.error('Failed to run installer:', e instanceof Error ? e.message : String(e));
        return false;
    }
}
(async () => {
    try {
        print('PATH=', process.env.PATH);
        const idb = process.env.IDB_PATH || which('idb');
        print('which idb:', idb);
        if (idb) {
            try {
                print('idb --version:', execSync('idb --version', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim());
            }
            catch (e) {
                print('idb --version: (failed)', e instanceof Error ? e.message : String(e));
            }
            const companion = which('idb_companion');
            print('which idb_companion:', companion);
            if (companion)
                try {
                    print('idb_companion --version:', execSync('idb_companion --version', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim());
                }
                catch (e) {
                    print('idb_companion --version: (failed)', e instanceof Error ? e.message : String(e));
                }
            process.exit(0);
        }
        print('idb not found');
        const auto = process.env.MCP_AUTO_INSTALL_IDB === 'true';
        if (auto) {
            print('MCP_AUTO_INSTALL_IDB=true, attempting installer...');
            const ok = await runInstaller();
            if (ok)
                process.exit(0);
            print('Installer failed or did not produce idb');
            process.exit(2);
        }
        print('Set MCP_AUTO_INSTALL_IDB=true to attempt automatic installation (CI-friendly).');
        process.exit(2);
    }
    catch (e) {
        console.error('idb healthcheck failed:', e instanceof Error ? e.message : String(e));
        process.exit(2);
    }
})();
