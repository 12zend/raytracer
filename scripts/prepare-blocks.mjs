import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// Public upstream build, pinned separately from editable sources. No remote compilation.
// Fetched into a throwaway repository so this workspace never becomes a shallow clone.
const revision = '4113c5348e6b4c76da9071a1800a62ab96ef793f';
const repository = 'https://github.com/TurboWarp/scratch-blocks.git';
const scratch = mkdtempSync(join(tmpdir(), 'raytracer-blocks-'));
const git = (args, options = {}) => execFileSync('git', ['-C', scratch, ...args], options);
try {
    git(['init', '--quiet', '--bare']);
    git(['fetch', '--quiet', '--depth', '1', repository, revision], {stdio: 'inherit'});
    for (const file of [
        'blockly_compressed_vertical.js',
        'blockly_compressed_horizontal.js',
        'blocks_compressed.js',
        'blocks_compressed_vertical.js',
        'blocks_compressed_horizontal.js'
    ]) {
        writeFileSync(`scratch-blocks/${file}`, git(['show', `${revision}:${file}`], {maxBuffer: 20 * 1024 * 1024}));
    }
} finally {
    rmSync(scratch, {recursive: true, force: true});
}
