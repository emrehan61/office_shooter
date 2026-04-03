import test from 'node:test';
import assert from 'node:assert/strict';

import { addAmmo, MAX_AMMO, consumeAmmo, createPlayer, respawn } from './player.js';

test('player starts with capped ammo and spends one round per shot', () => {
    const player = createPlayer();

    assert.equal(player.ammo, MAX_AMMO);
    assert.equal(consumeAmmo(player), true);
    assert.equal(player.ammo, MAX_AMMO - 1);

    player.ammo = 0;
    assert.equal(consumeAmmo(player), false);
    assert.equal(player.ammo, 0);
});

test('respawn refills ammo back to the cap', () => {
    const player = createPlayer();
    player.ammo = 3;
    player.hp = 0;
    player.alive = false;

    respawn(player);

    assert.equal(player.ammo, MAX_AMMO);
    assert.equal(player.hp, 100);
    assert.equal(player.alive, true);
});

test('kills can restore ammo but never above the cap', () => {
    const player = createPlayer();
    player.ammo = 228;

    addAmmo(player, 10);
    assert.equal(player.ammo, 238);

    addAmmo(player, 50);
    assert.equal(player.ammo, MAX_AMMO);
});
