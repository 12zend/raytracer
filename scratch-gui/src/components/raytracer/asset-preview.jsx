import React from 'react';
import PropTypes from 'prop-types';
import BufferedInputHOC from '../forms/buffered-input-hoc.jsx';
import Input from '../forms/input.jsx';
import styles from './asset-preview.css';

const BufferedInput = BufferedInputHOC(Input);

const FONT_SAMPLES = [
    {size: 48, text: 'Aa Bb Cc 123'},
    {size: 32, text: 'The quick brown fox jumps over the lazy dog'},
    {size: 32, text: '光と影 あいうえお アイウエオ'},
    {size: 20, text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 !?&%'}
];

const formatSize = bytes => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

/** Orbit viewer; the three.js scene lives in scratch-vm (raytracer.preview). */
class ModelView extends React.Component {
    constructor (props) {
        super(props);
        this.setCanvas = canvas => {
            this.canvas = canvas;
        };
    }
    componentDidMount () {
        this.start();
    }
    componentDidUpdate (prevProps) {
        if (prevProps.item !== this.props.item) {
            this.stop();
            this.start();
        }
    }
    componentWillUnmount () {
        this.stop();
    }
    start () {
        this.controller = this.props.preview.attachModelPreview(this.props.item, this.canvas);
        this.observer = new ResizeObserver(() => {
            this.controller.resize(this.canvas.clientWidth, this.canvas.clientHeight);
        });
        this.observer.observe(this.canvas);
    }
    stop () {
        if (this.observer) this.observer.disconnect();
        if (this.controller) this.controller.dispose();
        this.observer = null;
        this.controller = null;
    }
    render () {
        return (
            <canvas
                className={styles.model}
                ref={this.setCanvas}
            />
        );
    }
}
ModelView.propTypes = {
    item: PropTypes.object.isRequired,
    preview: PropTypes.object.isRequired
};

const Body = ({item, preview}) => {
    const kind = preview.kind(item);
    if (kind === 'Model') {
        return (<ModelView
            item={item}
            preview={preview}
        />);
    }
    if (kind === 'Video') {
        return (<video
            className={styles.media}
            src={item.url}
            controls
            loop
        />);
    }
    if (kind === 'Image') {
        return (<img
            className={styles.media}
            src={item.url}
            alt={item.name}
        />);
    }
    if (kind === 'Font') {
        return (
            <div
                className={styles.font}
                style={{fontFamily: `"${item.font.family}"`}}
            >
                {FONT_SAMPLES.map(sample => (
                    <p
                        key={sample.text}
                        style={{fontSize: sample.size}}
                    >{sample.text}</p>
                ))}
            </div>
        );
    }
    return (
        <table className={styles.info}>
            <tbody>
                {preview.describe(item).map(row => (
                    <tr key={row.label}>
                        <th>{row.label}</th>
                        <td>{row.value}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
};
Body.propTypes = {
    item: PropTypes.object.isRequired,
    preview: PropTypes.object.isRequired
};

const HINTS = {
    Model: 'Drag to orbit, scroll to zoom. Use it with the 3D “Add Object” block.',
    Motion: 'Apply it to a PMX object with the 3D “Apply motion / pose” block.',
    Pose: 'Apply it to a PMX object with the 3D “Apply motion / pose” block.',
    Video: 'Use it with “Add Object”; frame selects the video frame at 30 fps.'
};

/**
 * Preview for a scene asset in the costume list. Only the name can be edited.
 * @param {object} props Component props.
 * @returns {React.Element} Preview panel.
 */
const AssetPreview = ({item, preview, onRename}) => {
    const kind = preview.kind(item);
    return (
        <div className={styles.wrapper}>
            <div className={styles.header}>
                <BufferedInput
                    className={styles.name}
                    type="text"
                    value={item.name}
                    onSubmit={onRename}
                />
                <span className={styles.meta}>
                    {`${kind} · ${item.format.toUpperCase()} · ${formatSize(Math.floor(item.data.length * 3 / 4))}`}
                </span>
            </div>
            {item.missing && item.missing.length ? (
                <div className={styles.warning}>
                    {`Missing textures (shown white): ${item.missing.join(', ')}. ` +
                        'Upload images with these names as costumes, then upload the model again.'}
                </div>
            ) : null}
            <div className={styles.stage}>
                <Body
                    item={item}
                    preview={preview}
                />
            </div>
            {HINTS[kind] ? <div className={styles.hint}>{HINTS[kind]}</div> : null}
        </div>
    );
};
AssetPreview.propTypes = {
    item: PropTypes.object.isRequired,
    onRename: PropTypes.func.isRequired,
    preview: PropTypes.object.isRequired
};

export default AssetPreview;
