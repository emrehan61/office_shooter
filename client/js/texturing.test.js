import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function installCanvasStub() {
    globalThis.document = {
        createElement(tag) {
            if (tag !== 'canvas') {
                throw new Error(`Unexpected element request: ${tag}`);
            }
            return {
                width: 0,
                height: 0,
                getContext(kind) {
                    if (kind !== '2d') {
                        throw new Error(`Unexpected context request: ${kind}`);
                    }
                    return {
                        createImageData(width, height) {
                            return {
                                data: new Uint8ClampedArray(width * height * 4),
                            };
                        },
                        putImageData() {},
                    };
                },
            };
        },
    };
}

test('buildWorldGeometry assigns tiled UVs and textured materials to floors and walls', async () => {
    installCanvasStub();

    const { buildWorldGeometry, loadMap } = await import('./world.js');
    const mapData = JSON.parse(readFileSync(new URL('../maps/de_dust2.json', import.meta.url), 'utf8'));
    loadMap(mapData);

    const meshes = buildWorldGeometry({ skipFloorAO: true });
    const floorMesh = meshes[0];
    const wallMesh = meshes.find((mesh) => mesh?.isMesh && mesh.userData?.matID === 23 && mesh.userData?.kind !== 'platform');

    assert.ok(floorMesh?.isMesh);
    assert.ok(floorMesh.material?.map);
    assert.ok(floorMesh.geometry.getAttribute('uv'));
    assert.ok(Array.from(floorMesh.geometry.getAttribute('uv').array).some((value) => value > 10));

    assert.ok(wallMesh);
    assert.ok(wallMesh.material?.map);
    assert.ok(wallMesh.geometry.getAttribute('uv'));
    assert.ok(Array.from(wallMesh.geometry.getAttribute('uv').array).some((value) => value > 4));
});
