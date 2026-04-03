const keys = {};
let mouseDX = 0, mouseDY = 0;
let mouseDown = false;
let locked = false;

export function init(canvas) {
    window.addEventListener('keydown', (e) => { keys[e.code] = true; });
    window.addEventListener('keyup', (e) => { keys[e.code] = false; });

    canvas.addEventListener('click', () => {
        if (!locked) canvas.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
        locked = document.pointerLockElement === canvas;
    });

    document.addEventListener('mousemove', (e) => {
        if (locked) {
            mouseDX += e.movementX;
            mouseDY += e.movementY;
        }
    });

    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 0) mouseDown = true;
    });
    canvas.addEventListener('mouseup', (e) => {
        if (e.button === 0) mouseDown = false;
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
export function isLocked() { return locked; }
