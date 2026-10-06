import {
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  type DataArrayTexture,
  type Material,
  type Texture,
  Vector2,
} from 'three';
import type { WorldTextures } from './textures';

/**
 * Patch a standard material so its diffuse map is sampled from a texture
 * *array* using a per-vertex `aLayer` attribute. Lets the entire opaque world
 * (ground, walls, wood, rock, metal…) share a couple of draw calls while every
 * surface keeps its own tiling texture with correct mip-mapping.
 */
export function useTextureArray(mat: Material, arr: DataArrayTexture): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTexArr = { value: arr };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLayer;\nvarying float vLayer;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvLayer = aLayer;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2DArray uTexArr;\nvarying float vLayer;')
      .replace('#include <map_fragment>', 'diffuseColor *= texture(uTexArr, vec3(vMapUv, floor(vLayer + 0.5)));');
  };
  mat.customProgramCacheKey = () => 'texarray-v1';
}

export interface WorldMaterials {
  ground: MeshLambertMaterial;
  matte: MeshLambertMaterial;
  metal: MeshStandardMaterial;
  emissive: MeshBasicMaterial;
  water: MeshStandardMaterial;
  /** Materials for instanced props (share the array texture). */
  instanced: MeshLambertMaterial;
  all: Material[];
  setEnv(env: Texture | null): void;
  dispose(): void;
}

export function createWorldMaterials(tex: WorldTextures): WorldMaterials {
  const ground = new MeshLambertMaterial({ vertexColors: true, map: tex.dummy });
  useTextureArray(ground, tex.array);
  const matte = new MeshLambertMaterial({ vertexColors: true, map: tex.dummy });
  useTextureArray(matte, tex.array);
  const instanced = new MeshLambertMaterial({ vertexColors: true, map: tex.dummy });
  useTextureArray(instanced, tex.array);
  const metal = new MeshStandardMaterial({ vertexColors: true, map: tex.dummy, metalness: 0.55, roughness: 0.46, envMapIntensity: 0.9 });
  useTextureArray(metal, tex.array);
  const emissive = new MeshBasicMaterial({ vertexColors: true });
  tex.waterNormal.wrapS = RepeatWrapping;
  tex.waterNormal.wrapT = RepeatWrapping;
  const water = new MeshStandardMaterial({
    vertexColors: true,
    color: 0xffffff,
    roughness: 0.12,
    metalness: 0.15,
    normalMap: tex.waterNormal,
    normalScale: new Vector2(0.55, 0.55),
    envMapIntensity: 1.3,
  });
  const all: Material[] = [ground, matte, instanced, metal, emissive, water];
  return {
    ground,
    matte,
    metal,
    emissive,
    water,
    instanced,
    all,
    setEnv(env) {
      metal.envMap = env;
      water.envMap = env;
      metal.needsUpdate = true;
      water.needsUpdate = true;
    },
    dispose() {
      for (const m of all) m.dispose();
    },
  };
}
