import * as THREE from 'three';

// --- 初始化变量 ---
let scene, camera, renderer, planetParticles, ringParticles1, ringParticles2;
let lastPalmAngle = null;
let currentRotation = 0;
let targetDistance = 15;
const MIN_DISTANCE = 5;

const videoElement = document.getElementById('input_video');
const canvasElement = document.getElementById('video-container');
const canvasCtx = canvasElement.getContext('2d');

initThree();
initMediaPipe();
animate();

// --- Three.js 场景构建 ---
function initThree() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = targetDistance;

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(renderer.domElement);

    // 1. 创建橙色星球粒子 (大量、球形、明亮)
    const particleCount = 15000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
        // 使用球坐标系分布粒子，倾向于分布在表面
        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        
        // 核心星球半径约 3，粒子在 2.8 到 3.1 之间波动产生厚度感
        const r = 2.8 + Math.random() * 0.3;
        
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = r * Math.cos(phi);

        // 绚烂橙色 (R: 1.0, G: 0.4-0.6, B: 0)
        colors[i * 3] = 1.0;
        colors[i * 3 + 1] = 0.4 + Math.random() * 0.2;
        colors[i * 3 + 2] = 0.1;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 0.08,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    planetParticles = new THREE.Points(geometry, material);
    scene.add(planetParticles);

    // 2. 创建白色环绕粒子 (两层)
    ringParticles1 = createRing(5, 0.05); // 内环
    ringParticles2 = createRing(7, 0.04); // 外环
    scene.add(ringParticles1);
    scene.add(ringParticles2);

    window.addEventListener('resize', onWindowResize);
}

function createRing(radius, size) {
    const count = 3000;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = radius + (Math.random() - 0.5) * 0.5;
        pos[i * 3] = Math.cos(angle) * r;
        pos[i * 3 + 1] = (Math.random() - 0.5) * 0.2; // 扁平环
        pos[i * 3 + 2] = Math.sin(angle) * r;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({
        color: 0xffffff,
        size: size,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending
    }));
}

// --- MediaPipe 手势处理 ---
function initMediaPipe() {
    const hands = new window.Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7
    });

    hands.onResults(onResults);

    const cameraInput = new window.Camera(videoElement, {
        onFrame: async () => {
            await hands.send({ image: videoElement });
        },
        width: 640,
        height: 480
    });
    cameraInput.start();
}

function onResults(results) {
    // 绘制预览窗口
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        
        // 1. 旋转检测：计算掌心（点0）到中指根部（点9）的角度
        const p0 = landmarks[0];
        const p9 = landmarks[9];
        const angle = Math.atan2(p9.y - p0.y, p9.x - p0.x);
        
        if (lastPalmAngle !== null) {
            let delta = angle - lastPalmAngle;
            // 处理跨越 -PI/PI 的情况
            if (delta > Math.PI) delta -= Math.PI * 2;
            if (delta < -Math.PI) delta += Math.PI * 2;
            currentRotation += delta * 2; // 灵敏度
        }
        lastPalmAngle = angle;

        // 2. 伸缩/拉远检测
        const isFist = checkIsFist(landmarks);
        const zDepth = p0.z; // 这里的 z 是相对于摄像头的距离估计

        if (isFist) {
            // 握拳拉远：速度先慢后快 (二次方增长)
            const speed = Math.pow(Math.abs(zDepth) * 10, 2) * 0.05;
            targetDistance += speed;
        } else {
            // 5指张开靠近：速度先快后慢 (向目标插值)
            const speed = (targetDistance - MIN_DISTANCE) * 0.15;
            targetDistance -= speed;
        }
        targetDistance = Math.max(MIN_DISTANCE, Math.min(targetDistance, 50));
    } else {
        lastPalmAngle = null;
    }
    canvasCtx.restore();
}

function checkIsFist(landmarks) {
    // 简单的握拳逻辑：指尖到手掌中心的距离小于指根到中心的距离
    const fingerTips = [8, 12, 16, 20];
    const center = landmarks[9];
    let distSum = 0;
    fingerTips.forEach(idx => {
        const d = Math.hypot(landmarks[idx].x - center.x, landmarks[idx].y - center.y);
        distSum += d;
    });
    return distSum < 0.2; // 阈值根据实际距离调整
}

// --- 渲染循环 ---
function animate() {
    requestAnimationFrame(animate);

    // 平滑相机更新
    camera.position.z += (targetDistance - camera.position.z) * 0.1;
    
    // 星球旋转（手动控制 + 基础自转）
    planetParticles.rotation.y = currentRotation;
    ringParticles1.rotation.y = currentRotation * 0.8;
    ringParticles2.rotation.y = currentRotation * 1.2;

    // 环绕粒子的微小自转
    ringParticles1.rotation.z += 0.001;
    ringParticles2.rotation.z -= 0.001;

    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}