import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme, createThemeController } from '../src/theme.ts';

test('explicit themes override the OS; system preference resolves either OS theme', () => {
  for (const systemDark of [true,false]) {
    assert.equal(resolveTheme('dark',systemDark),'dark');
    assert.equal(resolveTheme('light',systemDark),'light');
    assert.equal(resolveTheme('system',systemDark),systemDark?'dark':'light');
  }
});

test('system mode follows live changes, fixed themes stay fixed, switching back reads current OS', () => {
  const handlers=new Set(),root={dataset:{}},media={matches:false,
    addEventListener:(_,handler)=>handlers.add(handler),removeEventListener:(_,handler)=>handlers.delete(handler)};
  const theme=createThemeController(root,media);
  const change=dark=>{media.matches=dark;for(const handler of handlers)handler({matches:dark});};
  theme.setPreference('system');assert.equal(root.dataset.theme,'light');
  change(true);assert.equal(root.dataset.theme,'dark');
  theme.setPreference('light');change(true);theme.setSystemTheme('dark');assert.equal(root.dataset.theme,'light');
  theme.setPreference('dark');change(false);assert.equal(root.dataset.theme,'dark');
  theme.setPreference('system');assert.equal(root.dataset.theme,'light');
  theme.setSystemTheme('dark');assert.equal(root.dataset.theme,'dark');
  theme.dispose();assert.equal(handlers.size,0);
});
