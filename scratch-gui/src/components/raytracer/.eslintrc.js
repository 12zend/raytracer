module.exports = {
    rules: {
        // Small local forms use closures for indexed argument fields; these are not hot render paths.
        'react/jsx-no-bind': 'off',
        'react/jsx-no-literals': 'off'
    }
};
