import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { IllustratedLighting } from '../../src/presentation/illustrated-lighting';
import { LocalLightShadows } from '../../src/presentation/local-light-shadows';

test('transient light activation preserves shader topology and only redraws live shadow slots after room priming', () => {
  const lighting = new IllustratedLighting(),
    scene = new T.Scene();
  const shadows = new LocalLightShadows(
    scene,
    { initRenderTarget: () => {} } as unknown as T.WebGLRenderer,
    lighting,
  );
  try {
    shadows.update(true);
    assert.ok(
      shadows.lights.every(
        (l) => l.visible && l.castShadow && l.shadow.needsUpdate && !l.shadow.autoUpdate,
      ),
    );
    for (const l of shadows.lights) l.shadow.map = new T.WebGLCubeRenderTarget(512);
    shadows.update(true);
    assert.ok(shadows.lights.every((l) => !l.shadow.needsUpdate));
    lighting.common.inkLightPower.value[0] = 1;
    lighting.common.inkLightPower.value[4] = 2;
    shadows.update(true);
    assert.ok(shadows.lights.every((l) => l.visible && l.castShadow));
    assert.deepEqual(
      shadows.lights.map((l) => l.shadow.needsUpdate),
      [true, false, false, false, true],
    );
    lighting.common.inkLightPower.value[4] = 0;
    shadows.update(true);
    assert.equal(shadows.lights[4]!.shadow.needsUpdate, false);
    lighting.common.inkLightPosition.value[4]!.set(9, 2, -2);
    lighting.common.inkLightPower.value[4] = 2;
    shadows.update(true);
    assert.deepEqual(shadows.lights[4]!.position.toArray(), [9, 2, -2]);
    assert.equal(shadows.lights[4]!.shadow.needsUpdate, true);
    shadows.reset();
    assert.equal(shadows.bytes(), 0);
    assert.ok(shadows.lights.every((l) => !l.visible && !l.castShadow && !l.shadow.needsUpdate));
  } finally {
    shadows.dispose();
    lighting.dispose();
  }
});

test('uniform overrides are configurable and restore only while owned', () => {
  const lighting = new IllustratedLighting(),
    scene = new T.Scene(),
    renderer = { initRenderTarget: () => {} } as unknown as T.WebGLRenderer;
  const first = new LocalLightShadows(scene, renderer, lighting);
  try {
    // A successor against the same lighting must not throw on redefinition.
    const second = new LocalLightShadows(scene, renderer, lighting);
    try {
      for (const uniform of lighting.localShadowMaps) {
        const descriptor = Object.getOwnPropertyDescriptor(uniform, 'value')!;
        assert.equal(typeof descriptor.get, 'function');
        assert.equal(descriptor.configurable, true);
      }
      // Retiring the predecessor must not clear its successor's getter.
      first.dispose();
      for (const uniform of lighting.localShadowMaps) {
        const descriptor = Object.getOwnPropertyDescriptor(uniform, 'value')!;
        assert.equal(typeof descriptor.get, 'function');
      }
    } finally {
      second.dispose();
    }
    // Once no shadows remain, uniforms return to writable nulls.
    for (const uniform of lighting.localShadowMaps) {
      const descriptor = Object.getOwnPropertyDescriptor(uniform, 'value')!;
      // oxlint-disable-next-line typescript/unbound-method -- Inspecting the accessor, never invoking it unbound.
      assert.equal(descriptor.get, undefined);
      assert.equal(descriptor.configurable, true);
      assert.equal(descriptor.writable, true);
      assert.equal(uniform.value, null);
    }
  } finally {
    lighting.dispose();
  }
});
