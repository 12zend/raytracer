// Kept outside Closure compilation: installed by the GUI after extension metadata.
module.exports = function installGPUBlocks(Blockly) {
    const mutationToDom = function () {
        const node = document.createElement('mutation');
        node.setAttribute('name', this.gpuName || 'kernel');
        node.setAttribute('params', JSON.stringify(this.gpuParams || []));
        return node;
    };
    const domToMutation = function (node) {
        this.gpuName = node.getAttribute('name') || 'kernel';
        this.gpuParams = JSON.parse(node.getAttribute('params') || '[]');
        for (const input of this.inputList.slice())
            this.removeInput(input.name);
        this.appendDummyInput('TITLE').appendField(
            `${this.type === 'rtgpu_define' ? 'define GPU' : 'GPU'} ${this.gpuName}`
        );
        if (this.type === 'rtgpu_define') {
            this.appendDummyInput('PARAMS').appendField(
                `uv: vec2  buffer: vec4  ${this.gpuParams.map((p) => `${p.name}: ${p.type}`).join('  ')}`
            );
        } else {
            this.appendValueInput('BUFFER').appendField('output buffer');
            this.gpuParams.forEach((p, i) =>
                this.appendValueInput(`ARG${i}`).appendField(p.name)
            );
        }
    };
    for (const type of ['rtgpu_define', 'rtgpu_call'])
        Blockly.Blocks[type] = {
            init: function () {
                this.setColour('#d84d83');
                this.setNextStatement(true);
                if (type === 'rtgpu_call') this.setPreviousStatement(true);
                this.setInputsInline(true);
                this.appendDummyInput('TITLE').appendField(
                    type === 'rtgpu_define' ? 'define GPU' : 'GPU'
                );
            },
            mutationToDom,
            domToMutation
        };
    Blockly.Blocks.rtgpu_argument = {
        init: function () {
            this.jsonInit({
                message0: 'argument %1',
                args0: [{type: 'field_input', name: 'NAME', text: 'value'}],
                output: null,
                outputShape: Blockly.OUTPUT_SHAPE_ROUND,
                colour: '#d84d83'
            });
        }
    };
};
