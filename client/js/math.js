// ─── Vector3 operations (vectors are [x, y, z]) ───
export const vec3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const vec3Add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vec3Sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vec3Scale = (v, s) => [v[0] * s, v[1] * s, v[2] * s];
export const vec3Length = (v) => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
export const vec3Dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vec3Cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];
export const vec3Normalize = (v) => {
    const l = vec3Length(v);
    return l > 1e-8 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0];
};
export const vec3Clone = (v) => [v[0], v[1], v[2]];
export const vec3Dist = (a, b) => vec3Length(vec3Sub(a, b));
export const lookDirFromYawPitch = (yaw, pitch) => [
    -Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
];

// ─── 4x4 Matrix (Float32Array, column-major for WebGL) ───
export function mat4Create() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function mat4Perspective(fov, aspect, near, far) {
    const f = 1.0 / Math.tan(fov * 0.5);
    const nf = 1.0 / (near - far);
    const out = new Float32Array(16);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[14] = 2 * far * near * nf;
    return out;
}

export function mat4Identity(out) {
    out.fill(0);
    out[0] = out[5] = out[10] = out[15] = 1;
    return out;
}

export function mat4Multiply(out, a, b) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

    let b0, b1, b2, b3;
    b0 = b[0]; b1 = b[1]; b2 = b[2]; b3 = b[3];
    out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
    out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
    out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
    out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    return out;
}

// Build FPS view matrix: Rx(-pitch) * Ry(-yaw) * T(-eye)
export function mat4FPSView(out, eye, yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);

    out[0] = cy;
    out[1] = sp * sy;
    out[2] = cp * sy;
    out[3] = 0;

    out[4] = 0;
    out[5] = cp;
    out[6] = -sp;
    out[7] = 0;

    out[8] = -sy;
    out[9] = sp * cy;
    out[10] = cp * cy;
    out[11] = 0;

    out[12] = -(cy * eye[0] - sy * eye[2]);
    out[13] = -(sp * sy * eye[0] + cp * eye[1] + sp * cy * eye[2]);
    out[14] = -(cp * sy * eye[0] - sp * eye[1] + cp * cy * eye[2]);
    out[15] = 1;

    return out;
}

// Translation matrix
export function mat4Translate(out, x, y, z) {
    mat4Identity(out);
    out[12] = x;
    out[13] = y;
    out[14] = z;
    return out;
}

// Rotation around Y axis
export function mat4RotateY(out, rad) {
    mat4Identity(out);
    const c = Math.cos(rad), s = Math.sin(rad);
    out[0] = c;
    out[8] = s;
    out[2] = -s;
    out[10] = c;
    return out;
}

// Compute forward direction from yaw
export const forwardFromYaw = (yaw) => [-Math.sin(yaw), 0, -Math.cos(yaw)];
export const rightFromYaw = (yaw) => [Math.cos(yaw), 0, -Math.sin(yaw)];

// Clamp a value
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
