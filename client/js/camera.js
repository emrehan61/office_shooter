import { clamp } from './math.js';

export const DEFAULT_FOV = Math.PI / 2;

export function createCamera() {
    return {
        position: [-15, 1.7, -15],
        yaw: Math.PI * 0.75,
        pitch: 0,
        fov: DEFAULT_FOV,
        near: 0.05,
        far: 100,
        sensitivity: 0.002,
    };
}

export function approachCameraFov(cam, targetFov, dt) {
    const blend = Math.min(1, dt * 12);
    cam.fov += (targetFov - cam.fov) * blend;
}

export function updateCamera(cam, mouseDX, mouseDY, _aspect) {
    cam.yaw -= mouseDX * cam.sensitivity;
    cam.pitch = clamp(cam.pitch - mouseDY * cam.sensitivity, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
}
