import React from 'react';
import PropTypes from 'prop-types';
import Modal from '../modal/modal.jsx';
class GPUEditor extends React.Component {
    constructor (props) {
        super(props);
        this.state = {name: 'kernel', params: [], error: ''};
    }
    render () {
        return (
            <Modal
                contentLabel="Make a GPU block"
                onRequestClose={this.props.onClose}
            >
                <form
                    style={{padding: 24}}
                    onSubmit={e => {
                        e.preventDefault();
                        try {
                            this.props.onCreate(
                                this.state.name,
                                this.state.params
                            );
                        } catch (error) {
                            this.setState({error: error.message});
                        }
                    }}
                >
                    <label>
                        Block name{' '}
                        <input
                            autoFocus
                            value={this.state.name}
                            onChange={e =>
                                this.setState({name: e.target.value})
                            }
                        />
                    </label>
                    <p>
                        Implicit inputs: uv (vec2), buffer (previous pixel,
                        vec4). Return a vec4 color.
                    </p>
                    {this.state.params.map((p, i) => (
                        <p key={i}>
                            <input
                                aria-label={`Argument ${i + 1} name`}
                                value={p.name}
                                onChange={e =>
                                    this.setState({
                                        params: this.state.params.map((v, k) =>
                                            (k === i ?
                                                {...v, name: e.target.value} :
                                                v)
                                        )
                                    })
                                }
                            />
                            <select
                                aria-label={`Argument ${i + 1} type`}
                                value={p.type}
                                onChange={e =>
                                    this.setState({
                                        params: this.state.params.map((v, k) =>
                                            (k === i ?
                                                {...v, type: e.target.value} :
                                                v)
                                        )
                                    })
                                }
                            >
                                {['float', 'vec2', 'vec3', 'vec4', 'bool'].map(
                                    t => (
                                        <option key={t}>{t}</option>
                                    )
                                )}
                            </select>
                            <button
                                type="button"
                                onClick={() =>
                                    this.setState({
                                        params: this.state.params.filter(
                                            (v, k) => k !== i
                                        )
                                    })
                                }
                            >
                                Remove
                            </button>
                        </p>
                    ))}
                    <button
                        type="button"
                        onClick={() =>
                            this.setState({
                                params: [
                                    ...this.state.params,
                                    {
                                        name: `value${this.state.params.length + 1}`,
                                        type: 'float'
                                    }
                                ]
                            })
                        }
                    >
                        Add argument
                    </button>
                    <p role="alert">{this.state.error}</p>
                    <button type="submit">Create GPU definition</button>
                </form>
            </Modal>
        );
    }
}
GPUEditor.propTypes = {
    onClose: PropTypes.func.isRequired,
    onCreate: PropTypes.func.isRequired
};
export default GPUEditor;
