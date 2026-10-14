module.exports = {
    rules: {
        // Vector formulas use the normal arithmetic precedence; shader templates retain GLSL layout.
        'no-mixed-operators': 'off',
        'max-len': ['error', {code: 120, ignoreTemplateLiterals: true, ignoreStrings: true}]
    }
};
