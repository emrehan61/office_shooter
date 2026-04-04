const keys = {};
let mouseDX = 0, mouseDY = 0;
let mouseDown = false;
let rightMouseDown = false;
let locked = false;
let pointerLockEnabled = true;

export function init(canvas) {
    window.addEventListener('keydown', (e) => { keys[e.code] = true; });
    window.addEventListener('keyup', (e) => { keys[e.code] = false; });

    canvas.addEventListener('click', () => {
        if (!locked && pointerLockEnabled) canvas.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
        locked = document.pointerLockElement === canvas;
        if (!locked) {
            mouseDown = false;
            rightMouseDown = false;
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (locked) {
            mouseDX += e.movementX;
            mouseDY += e.movementY;
        }
    });

    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 0) mouseDown = true;
        if (e.button === 2) rightMouseDown = true;
    });
    canvas.addEventListener('mouseup', (e) => {
        if (e.button === 0) mouseDown = false;
        if (e.button === 2) rightMouseDown = false;
    });
    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });
}

export function consumeMouse() {
    const dx = mouseDX, dy = mouseDY;
    mouseDX = 0;
    mouseDY = 0;
    return { dx, dy };
}

export function isKeyDown(code) { return !!keys[code]; }
export function isMouseDown() { return mouseDown && locked; }
export function isRightMouseDown() { return rightMouseDown && locked; }
export function isLocked() { return locked; }
export function setPointerLockEnabled(enabled) {
    pointerLockEnabled = !!enabled;
    if (!pointerLockEnabled) {
        mouseDown = false;
        rightMouseDown = false;
    }
}
