import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createFallbackVisitorAvatar } from './visitor-avatar-fallback';
import { disposeVisitorModel } from './visitor-avatar-rig';
import { createVisitorAvatarModel } from './visitor-avatar-model';

/** One locally hosted visitor. The lightweight fallback covers loading/failure. */
export function createVisitorAvatar(options: { invalidate?: () => void; failed?: () => void } = {}) {
  const fallback = createFallbackVisitorAvatar(), root = fallback.root;
  const placeholder = root.children[0], contactShadow = root.children.at(-1)!;
  const lifetime = new AbortController();
  let avatar: ReturnType<typeof createVisitorAvatarModel> | undefined;
  let loading: Promise<void> | undefined, disposed = false;
  function load() {
    if (disposed || avatar || loading) return;
    loading = (async () => {
      let model: T.Group | undefined;
      try {
        const url = new URL('assets/venue/characters/visitor-nathan.glb', document.baseURI);
        const response = await fetch(url, { signal: lifetime.signal });
        if (!response.ok) throw new Error(`Visitor model could not load (${response.status})`);
        const bytes = await response.arrayBuffer();
        lifetime.signal.throwIfAborted();
        const gltf = await new GLTFLoader().parseAsync(bytes, '');
        model = gltf.scene;
        if (disposed) { disposeVisitorModel(model); return; }
        avatar = createVisitorAvatarModel(model, gltf.animations);
        root.add(avatar.root); root.add(contactShadow);
        placeholder.visible = false;
        options.invalidate?.();
      } catch (error) {
        if (model) disposeVisitorModel(model);
        if (!disposed) { console.warn('Visitor avatar unavailable:', error); options.failed?.(); }
      } finally { loading = undefined; }
    })();
  }
  return {
    root, load,
    update(dt: number, speed: number, reducedMotion: boolean, jumpHeight = 0) {
      const moving = fallback.update(dt, speed, reducedMotion, jumpHeight);
      return avatar ? avatar.update(dt, speed, reducedMotion, jumpHeight) : moving;
    },
    dispose() {
      if (disposed) return;
      disposed = true; lifetime.abort();
      avatar?.dispose(); fallback.dispose();
    },
  };
}
