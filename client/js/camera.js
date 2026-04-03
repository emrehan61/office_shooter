import { mat4Create, mat4FPSView, clamp, mat4Perspective } from './math.js';

export function createCamera() {
    return {
        position: [-15, 1.7, -15],
        yaw: Math.PI * 0.75,
        pitch: 0,
        fov: Math.PI / 2, // 90 degrees
        near: 0.05,
        far: 100,
        sensitivity: 0.002,
        viewMatrix: mat4Create(),
        projMatrix: mat4Create(),
    };
}

export function updateCamera(cam, mouseDX, mouseDY, aspect) {
    cam.yaw -= mouseDX * cam.sensitivity;
    cam.pitch = clamp(cam.pitch - mouseDY * cam.sensitivity, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);

    mat4FPSView(cam.viewMatrix, cam.position, cam.yaw, cam.pitch);
    const newProj = mat4Perspective(cam.fov, aspect, cam.near, cam.far);
    cam.projMatrix.set(newProj);
}
