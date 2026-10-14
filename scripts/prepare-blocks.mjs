import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
// Public upstream build, pinned separately from editable sources. No remote compilation.
const revision = '4113c5348e6b4c76da9071a1800a62ab96ef793f';
execFileSync(
    'git',
    ['-C', 'scratch-blocks', 'fetch', '--depth', '1', 'origin', revision],
    {stdio: 'inherit'}
);
for (const file of [
    'blockly_compressed_vertical.js',
    'blockly_compressed_horizontal.js',
    'blocks_compressed.js',
    'blocks_compressed_vertical.js',
    'blocks_compressed_horizontal.js'
]) {
    writeFileSync(
        `scratch-blocks/${file}`,
        execFileSync(
            'git',
            ['-C', 'scratch-blocks', 'show', `${revision}:${file}`],
            {maxBuffer: 20 * 1024 * 1024}
        )
    );
}
