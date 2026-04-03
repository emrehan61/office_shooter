import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAvatarVerts, getPlayerPalette } from './avatar.js';
import { TEAM_BLUE, TEAM_GREEN } from './teams.js';

function materialIds(vertices) {
    const ids = new Set();
    for (let i = 5; i < vertices.length; i += 6) {
        ids.add(vertices[i]);
    }
    return ids;
}

test('different players get different palette materials', () => {
    const p1 = getPlayerPalette(1);
    const p2 = getPlayerPalette(2);

    assert.notEqual(p1.primary, p2.primary);
});

test('team palettes map blue and green players to team colors', () => {
    assert.equal(getPlayerPalette(1, TEAM_BLUE).primary, 6);
    assert.equal(getPlayerPalette(1, TEAM_GREEN).primary, 7);
});

test('avatar geometry includes skin and colored armor materials', () => {
    const verts = buildAvatarVerts(3, { pos: [0, 1.7, 0], yaw: 0, shotTime: 0 });
    const mats = materialIds(verts);

    assert.ok(mats.has(9));
    assert.ok(mats.has(getPlayerPalette(3).primary));
});

test('crouching lowers the avatar silhouette', () => {
    const standing = buildAvatarVerts(1, { pos: [0, 1.7, 0], yaw: 0, shotTime: 0, crouching: false });
    const crouching = buildAvatarVerts(1, { pos: [0, 1.15, 0], yaw: 0, shotTime: 0, crouching: true });

    const standingTop = Math.max(...standing.filter((_, index) => index % 6 === 1));
    const crouchingTop = Math.max(...crouching.filter((_, index) => index % 6 === 1));

    assert.ok(crouchingTop < standingTop);
});
