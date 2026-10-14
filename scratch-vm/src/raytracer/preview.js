// Read-only previews of scene assets for the costume list (thumbnails and an orbit viewer).
const THREE = require('three');
const {OrbitControls} = require('three/examples/jsm/controls/OrbitControls');
const {clone} = require('three/examples/jsm/utils/SkeletonUtils');

const KINDS = Object.fromEntries([
    ['Model', ['obj', 'fbx', 'glb', 'pmx']],
    ['Motion', ['vmd']],
    ['Pose', ['vpd']],
    ['Image', ['png', 'jpg', 'jpeg', 'svg']],
    ['Video', ['mp4']],
    ['Font', ['ttf', 'otf', 'woff', 'woff2']]
].flatMap(([name, formats]) => formats.map(format => [format, name])));
const THUMBNAIL = {width: 160, height: 120};
const FRAME_RATE = 30;

const kind = item => KINDS[item.format] || 'Media';

const createStage = object => {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x303040, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    scene.add(object);
    object.traverse(mesh => {
        // OBJ files without vn records still need shading in the preview.
        if (mesh.isMesh && mesh.geometry && !mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals();
    });
    const camera = new THREE.PerspectiveCamera(35, THUMBNAIL.width / THUMBNAIL.height, 0.01, 1000);
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const radius = box.isEmpty() ? 1 : Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1e-3);
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.position.copy(center).add(new THREE.Vector3(0.6, 0.4, 1).normalize()
        .multiplyScalar(distance));
    camera.near = distance / 100;
    camera.far = distance * 100;
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    return {scene, camera, center};
};

let thumbnailRenderer = null;
const renderModelThumbnail = item => {
    if (!thumbnailRenderer) {
        const canvas = document.createElement('canvas');
        canvas.width = THUMBNAIL.width;
        canvas.height = THUMBNAIL.height;
        // One shared context: browsers cap the number of live WebGL contexts.
        thumbnailRenderer = new THREE.WebGLRenderer({
            canvas,
            alpha: true,
            antialias: true,
            preserveDrawingBuffer: true
        });
        thumbnailRenderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    const {scene, camera} = createStage(clone(item.object));
    thumbnailRenderer.setClearColor(0x000000, 0);
    thumbnailRenderer.render(scene, camera);
    return thumbnailRenderer.domElement.toDataURL('image/png');
};

const canvasThumbnail = draw => {
    const canvas = document.createElement('canvas');
    canvas.width = THUMBNAIL.width;
    canvas.height = THUMBNAIL.height;
    draw(canvas.getContext('2d'), canvas);
    return canvas.toDataURL('image/png');
};

const labelThumbnail = (text, font = 'bold 40px "Helvetica Neue", Helvetica, Arial, sans-serif') =>
    canvasThumbnail(context => {
        context.fillStyle = '#855cd6';
        context.font = font;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, THUMBNAIL.width / 2, THUMBNAIL.height / 2);
    });

/**
 * Thumbnail data URL for the costume list. Cached on the item.
 * @param {object} item Scene asset.
 * @returns {string} Data URL.
 */
const thumbnail = item => {
    if (item.thumbnail) return item.thumbnail;
    let url;
    try {
        if (item.object) {
            url = renderModelThumbnail(item);
        } else if (item.element) {
            const element = item.element;
            const width = element.videoWidth || element.naturalWidth;
            const height = element.videoHeight || element.naturalHeight;
            url = canvasThumbnail(context => {
                const scale = Math.min(THUMBNAIL.width / width, THUMBNAIL.height / height);
                context.drawImage(element, (THUMBNAIL.width - (width * scale)) / 2,
                    (THUMBNAIL.height - (height * scale)) / 2, width * scale, height * scale);
            });
        } else if (item.font) {
            url = labelThumbnail('Aa', `64px "${item.font.family}"`);
        } else {
            url = labelThumbnail(item.format.toUpperCase());
        }
    } catch (e) {
        url = labelThumbnail(item.format.toUpperCase());
    }
    item.thumbnail = url;
    return url;
};

/**
 * Summary lines for motion and pose assets.
 * @param {object} item Scene asset.
 * @returns {Array.<{label: string, value: string}>} Rows.
 */
const describe = item => {
    if (item.motion) {
        const motion = item.motion;
        const frames = Math.max(0, ...motion.motions.map(m => m.frameNum), ...motion.morphs.map(m => m.frameNum));
        return [
            {label: 'Model', value: motion.metadata.name || '—'},
            {label: 'Length', value: `${frames} frames (${(frames / FRAME_RATE).toFixed(2)} s at ${FRAME_RATE} fps)`},
            {label: 'Bones', value: String(new Set(motion.motions.map(m => m.boneName)).size)},
            {label: 'Morphs', value: String(new Set(motion.morphs.map(m => m.morphName)).size)},
            {label: 'Bone keys', value: String(motion.motions.length)},
            {label: 'Camera keys', value: String((motion.cameras || []).length)}
        ];
    }
    if (item.pose) {
        return [
            {label: 'Bones', value: String(item.pose.bones.length)},
            {label: 'Names', value: item.pose.bones.map(b => b.name).join(', ')}
        ];
    }
    return [];
};

/**
 * Orbit viewer for a model asset. Drag to rotate, scroll to zoom; animations loop at 30 fps.
 * @param {object} item Model asset.
 * @param {HTMLCanvasElement} canvas Target canvas.
 * @returns {{resize: function(number, number), dispose: function()}} Controller.
 */
const attachModelPreview = (item, canvas) => {
    const renderer = new THREE.WebGLRenderer({canvas, alpha: true, antialias: true});
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    const object = clone(item.object);
    const {scene, camera, center} = createStage(object);
    const controls = new OrbitControls(camera, canvas);
    controls.target.copy(center);
    controls.enableDamping = true;
    controls.update();
    let mixer = null;
    const clips = item.object.animations || [];
    if (clips.length) {
        mixer = new THREE.AnimationMixer(object);
        mixer.clipAction(clips[0]).play();
    }
    const clock = new THREE.Clock();
    let frame = 0;
    const tick = () => {
        frame = requestAnimationFrame(tick);
        if (mixer) mixer.update(clock.getDelta());
        controls.update();
        renderer.render(scene, camera);
    };
    tick();
    return {
        resize (width, height) {
            renderer.setSize(width, height, false);
            camera.aspect = width / Math.max(height, 1);
            camera.updateProjectionMatrix();
        },
        dispose () {
            cancelAnimationFrame(frame);
            controls.dispose();
            renderer.dispose();
            renderer.forceContextLoss();
        }
    };
};

module.exports = {kind, thumbnail, describe, attachModelPreview, FRAME_RATE};
