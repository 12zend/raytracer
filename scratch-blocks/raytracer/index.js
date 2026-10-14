// Kept outside Closure compilation: installed by the GUI after extension metadata.
//
// GPU definitions are ordinary My Blocks definitions (procedures_definition + procedures_prototype)
// whose prototype mutation carries gpu="true". Two implicit arguments, uv and buffer, are appended
// to the procedure code. The caller (rtgpu_call) reuses procedures_call rendering, hides uv and
// turns buffer into the output buffer name.

const COLOURS = ['#d84d83', '#c0436f', '#a8395f'];
const IMPLICIT_NAMES = ['uv', 'buffer'];
const IMPLICIT_CODE = ' %s %s';
const BUFFER_LABEL = 'buffer';

const parse = (mutation, name, fallback) => JSON.parse(mutation.getAttribute(name) || fallback);

const isGPUMutation = mutation => !!mutation && mutation.getAttribute('gpu') === 'true';

/**
 * Turn a mutation from the My Blocks editor into a GPU definition mutation.
 * @param {!Element} mutation Mutation returned by the custom procedures modal.
 * @param {?Array.<string>} implicitIds Existing ids for uv and buffer (when editing).
 * @param {function(): string} genUid Id generator.
 * @return {!Element} New mutation.
 */
const toGPUMutation = (mutation, implicitIds, genUid) => {
    const names = parse(mutation, 'argumentnames', '[]');
    const reserved = names.filter(name => IMPLICIT_NAMES.includes(name));
    if (reserved.length) {
        throw new Error(`"${reserved[0]}" is created automatically for GPU blocks; choose another input name.`);
    }
    const result = mutation.cloneNode(false);
    result.setAttribute('proccode', mutation.getAttribute('proccode') + IMPLICIT_CODE);
    result.setAttribute('argumentids', JSON.stringify([
        ...parse(mutation, 'argumentids', '[]'),
        ...(implicitIds || IMPLICIT_NAMES.map(() => genUid()))
    ]));
    result.setAttribute('argumentnames', JSON.stringify([...names, ...IMPLICIT_NAMES]));
    result.setAttribute('argumentdefaults', JSON.stringify([
        ...parse(mutation, 'argumentdefaults', '[]'),
        ...IMPLICIT_NAMES.map(() => '')
    ]));
    result.setAttribute('warp', 'false');
    result.setAttribute('gpu', 'true');
    return result;
};

/**
 * Remove the implicit arguments so the My Blocks editor only shows user arguments.
 * @param {!Element} mutation GPU definition mutation.
 * @return {{mutation: !Element, implicitIds: !Array.<string>}} Editable mutation and the implicit ids.
 */
const fromGPUMutation = mutation => {
    const strip = values => values.slice(0, -IMPLICIT_NAMES.length);
    const ids = parse(mutation, 'argumentids', '[]');
    const result = mutation.cloneNode(false);
    result.removeAttribute('gpu');
    result.setAttribute('proccode', mutation.getAttribute('proccode').slice(0, -IMPLICIT_CODE.length));
    result.setAttribute('argumentids', JSON.stringify(strip(ids)));
    result.setAttribute('argumentnames', JSON.stringify(strip(parse(mutation, 'argumentnames', '[]'))));
    result.setAttribute('argumentdefaults', JSON.stringify(strip(parse(mutation, 'argumentdefaults', '[]'))));
    return {mutation: result, implicitIds: ids.slice(-IMPLICIT_NAMES.length)};
};

const prototypeOf = definition => {
    const input = definition.getInput('custom_block');
    return input && input.connection && input.connection.targetBlock();
};

/** Colour GPU definitions and label them "define GPU". */
const styleGPUDefinitions = workspace => {
    for (const definition of workspace.getTopBlocks(false)) {
        if (definition.type !== 'procedures_definition') continue;
        const prototype = prototypeOf(definition);
        if (!prototype || !prototype.gpu_) continue;
        for (const block of [definition, ...prototype.getDescendants(false)]) {
            if (block.getColour() !== COLOURS[0]) block.setColour(...COLOURS);
        }
        const label = definition.getInput('custom_block').fieldRow[0];
        if (label && label.getText() !== 'define GPU') label.setText('define GPU');
    }
};

/** Update GPU callers after their definition was edited. */
const mutateGPUCallers = (Blockly, workspace, oldProcCode, mutation) => {
    Blockly.Events.setGroup(true);
    for (const caller of workspace.getAllBlocks()) {
        if (caller.type !== 'rtgpu_call' || caller.definitionProcCode_ !== oldProcCode) continue;
        const before = Blockly.Xml.domToText(caller.mutationToDom());
        caller.domToMutation(mutation.cloneNode(false));
        const after = Blockly.Xml.domToText(caller.mutationToDom());
        if (before !== after) {
            Blockly.Events.fire(new Blockly.Events.BlockChange(caller, 'mutation', null, before, after));
        }
    }
    Blockly.Events.setGroup(false);
};

const install = function (Blockly) {
    const prototype = Blockly.Blocks.procedures_prototype;
    if (!prototype.gpuInstalled_) {
        prototype.gpuInstalled_ = true;
        const toDom = prototype.mutationToDom;
        const fromDom = prototype.domToMutation;
        prototype.mutationToDom = function (generateShadows) {
            const mutation = toDom.call(this, generateShadows);
            if (this.gpu_) mutation.setAttribute('gpu', 'true');
            return mutation;
        };
        prototype.domToMutation = function (mutation) {
            this.gpu_ = isGPUMutation(mutation);
            fromDom.call(this, mutation);
        };
        // GPU definitions are listed in the GPU category, not My Blocks.
        const allMutations = Blockly.Procedures.allProcedureMutations;
        Blockly.Procedures.allProcedureMutations = root =>
            allMutations(root).filter(mutation => !isGPUMutation(mutation));
    }

    const call = Blockly.Blocks.procedures_call;
    Blockly.Blocks.rtgpu_call = Object.assign({}, call, {
        init: function () {
            this.jsonInit({extensions: ['shape_statement']});
            this.setColour(...COLOURS);
            this.procCode_ = '';
            this.argumentIds_ = [];
            this.warp_ = false;
            this.return_ = Blockly.PROCEDURES_CALL_TYPE_STATEMENT;
            this.definitionProcCode_ = '';
            this.definitionArgumentIds_ = [];
        },
        mutationToDom: function () {
            const mutation = document.createElement('mutation');
            mutation.setAttribute('proccode', this.definitionProcCode_);
            mutation.setAttribute('argumentids', JSON.stringify(this.definitionArgumentIds_));
            mutation.setAttribute('gpu', 'true');
            return mutation;
        },
        domToMutation: function (mutation) {
            const procCode = mutation.getAttribute('proccode') || '';
            const ids = parse(mutation, 'argumentids', '[]');
            this.definitionProcCode_ = procCode;
            this.definitionArgumentIds_ = ids;
            this.generateShadows_ = JSON.parse(mutation.getAttribute('generateshadows'));
            // Hide uv; the buffer argument names the output buffer.
            this.procCode_ = `${procCode.slice(0, -IMPLICIT_CODE.length)} ${BUFFER_LABEL} %s`;
            this.argumentIds_ = [...ids.slice(0, -IMPLICIT_NAMES.length), ids[ids.length - 1]];
            this.bufferId_ = ids[ids.length - 1];
            this.updateDisplay_();
        },
        attachShadow_: function (input, argumentType) {
            call.attachShadow_.call(this, input, argumentType);
            const shadow = input.connection.targetBlock();
            if (input.name === this.bufferId_ && shadow) shadow.setFieldValue('main', 'TEXT');
        }
    });
};

module.exports = install;
module.exports.isGPUMutation = isGPUMutation;
module.exports.toGPUMutation = toGPUMutation;
module.exports.fromGPUMutation = fromGPUMutation;
module.exports.styleGPUDefinitions = styleGPUDefinitions;
module.exports.mutateGPUCallers = mutateGPUCallers;
module.exports.COLOURS = COLOURS;
