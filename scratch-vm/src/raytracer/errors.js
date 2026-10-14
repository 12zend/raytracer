/**
 * Error shown to the user in the editor. blockId points at the block to reveal, when known.
 */
class RaytracerError extends Error {
    constructor (message, blockId = null) {
        super(message);
        this.name = 'RaytracerError';
        this.blockId = blockId;
    }
}

const TYPE_NAMES = {
    float: 'a number',
    bool: 'a boolean',
    vec2: 'a vec2',
    vec3: 'a vec3',
    vec4: 'a vec4',
    Hit: 'a ray hit'
};
const typeName = type => TYPE_NAMES[type] || type;

module.exports = {RaytracerError, typeName};
