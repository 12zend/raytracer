import {execFileSync} from 'node:child_process';
for (const repo of [
    'scratch-blocks',
    'scratch-render',
    'scratch-vm',
    'scratch-gui'
])
    execFileSync(
        process.platform === 'win32' ? 'npm.cmd' : 'npm',
        ['install', '--prefix', repo, '--legacy-peer-deps', '--ignore-scripts'],
        {stdio: 'inherit'}
    );
await import('./prepare-blocks.mjs');
execFileSync(process.execPath, ['scripts/prepublish.mjs'], {
    cwd: 'scratch-gui',
    stdio: 'inherit'
});
