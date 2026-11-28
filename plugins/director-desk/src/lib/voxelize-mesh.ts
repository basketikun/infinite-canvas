import {
  Box3, BufferAttribute, BufferGeometry, Color, Matrix4, SRGBColorSpace, Triangle, Vector2, Vector3,
  type InstancedMesh, type Material, type Mesh, type Object3D, type Texture,
} from 'three';

type Coordinates = [number, number, number];
export type SparseVoxelGrid = { origin: Coordinates; dimensions: Coordinates; voxelSize: number; cells: Record<string, string> };
export const VOXEL_RESOLUTIONS = [16, 32, 64, 128] as const;
type Options = { resolution?: number; mode?: 'shell' | 'solid'; frame?: Object3D };
type SurfaceMaterial = Material & { color?: Color; map?: Texture };
type Visit = (triangle: Triangle, geometry: BufferGeometry, material: SurfaceMaterial | undefined, indices: Coordinates, tint?: Color) => void;

function forEachTriangle(object: Object3D, inverseFrame: Matrix4, visit: Visit) {
  const triangle = new Triangle();
  const matrix = new Matrix4();
  const instanceMatrix = new Matrix4();
  const instanceColor = new Color();
  object.traverseVisible((item) => {
    const mesh = item as Mesh;
    const geometry = mesh.geometry;
    if (!mesh.isMesh || !geometry?.attributes.position) return;
    const index = geometry.index;
    const count = index?.count ?? geometry.attributes.position.count;
    const drawEnd = geometry.drawRange.start + geometry.drawRange.count;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = Array.isArray(mesh.material) ? geometry.groups : [{ start: 0, count, materialIndex: 0 }];
    const instanced = mesh as InstancedMesh;
    const instanceCount = instanced.isInstancedMesh ? instanced.count : 1;

    for (let instance = 0; instance < instanceCount; instance++) {
      matrix.multiplyMatrices(inverseFrame, mesh.matrixWorld);
      const tint = instanced.isInstancedMesh && instanced.instanceColor ? instanceColor : undefined;
      if (instanced.isInstancedMesh) {
        instanced.getMatrixAt(instance, instanceMatrix);
        matrix.multiply(instanceMatrix);
        if (tint) instanced.getColorAt(instance, tint);
      }
      for (const group of groups) {
        const material = materials[group.materialIndex ?? 0];
        if (material?.visible === false) continue;
        const start = Math.max(geometry.drawRange.start, group.start);
        const end = Math.min(count, drawEnd, group.start + group.count);
        for (let i = start; i + 2 < end; i += 3) {
          const indices: Coordinates = index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2];
          mesh.getVertexPosition(indices[0], triangle.a).applyMatrix4(matrix);
          mesh.getVertexPosition(indices[1], triangle.b).applyMatrix4(matrix);
          mesh.getVertexPosition(indices[2], triangle.c).applyMatrix4(matrix);
          const area = triangle.getArea();
          if (Number.isFinite(area) && area > 0) visit(triangle, geometry, material, indices, tint);
        }
      }
    }
  });
}

type Pixels = { data: Uint8Array | Uint8ClampedArray; width: number; height: number; channels: number };

function readPixels(map: Texture): Pixels | null {
  const source = map.image;
  const width = source?.naturalWidth || source?.videoWidth || source?.width;
  const height = source?.naturalHeight || source?.videoHeight || source?.height;
  if (!width || !height) return null;
  if (source.data instanceof Uint8Array || source.data instanceof Uint8ClampedArray) {
    const channels = source.data.length / (width * height);
    return channels === 3 || channels === 4 ? { data: source.data, width, height, channels } : null;
  }
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(source, 0, 0, width, height);
    return { data: context.getImageData(0, 0, width, height).data, width, height, channels: 4 };
  } catch {
    // Tainted or GPU-only textures still retain the material and vertex colors.
    return null;
  }
}

function sampleColors() {
  const textures = new WeakMap<Texture, Pixels | null>();
  const weights = new Vector3();
  const uv = new Vector2();
  const result = new Color();
  const sample = new Color();
  return (triangle: Triangle, point: Vector3, geometry: BufferGeometry, material: SurfaceMaterial | undefined, [a, b, c]: Coordinates, tint?: Color) => {
    if (material?.color) result.copy(material.color);
    else result.setHex(0xffffff);
    if (tint) result.multiply(tint);
    const vertex = material?.vertexColors && geometry.getAttribute('color');
    const map = material?.map;
    const texcoords = map && geometry.getAttribute(map.channel ? `uv${map.channel}` : 'uv');
    if (vertex || texcoords) triangle.getBarycoord(point, weights);
    if (vertex) {
      sample.setRGB(
        vertex.getX(a) * weights.x + vertex.getX(b) * weights.y + vertex.getX(c) * weights.z,
        vertex.getY(a) * weights.x + vertex.getY(b) * weights.y + vertex.getY(c) * weights.z,
        vertex.getZ(a) * weights.x + vertex.getZ(b) * weights.y + vertex.getZ(c) * weights.z,
      );
      result.multiply(sample);
    }
    if (map && texcoords) {
      if (!textures.has(map)) {
        if (map.matrixAutoUpdate) map.updateMatrix();
        textures.set(map, readPixels(map));
      }
      const pixels = textures.get(map);
      if (pixels) {
        uv.set(
          texcoords.getX(a) * weights.x + texcoords.getX(b) * weights.y + texcoords.getX(c) * weights.z,
          texcoords.getY(a) * weights.x + texcoords.getY(b) * weights.y + texcoords.getY(c) * weights.z,
        );
        map.transformUv(uv);
        const x = Math.max(0, Math.min(pixels.width - 1, Math.floor(uv.x * pixels.width)));
        const y = Math.max(0, Math.min(pixels.height - 1, Math.floor(uv.y * pixels.height)));
        const pixel = (y * pixels.width + x) * pixels.channels;
        sample.setRGB(pixels.data[pixel] / 255, pixels.data[pixel + 1] / 255, pixels.data[pixel + 2] / 255, map.colorSpace);
        result.multiply(sample);
      }
    }
    return result.getHex(SRGBColorSpace) + 1;
  };
}

/** Flood-fill empty space from the boundary, then propagate surface colors into enclosed cells. */
function fillInterior(colors: Uint32Array, [width, height, depth]: Coordinates) {
  const plane = width * height;
  const exterior = new Uint8Array(colors.length);
  const queue = new Uint32Array(colors.length);
  let tail = 0;
  const enqueueExterior = (index: number) => {
    if (colors[index] || exterior[index]) return;
    exterior[index] = 1;
    queue[tail++] = index;
  };
  const neighbors = (index: number, visit: (index: number) => void) => {
    const x = index % width;
    const y = Math.floor(index / width) % height;
    const z = Math.floor(index / plane);
    if (x > 0) visit(index - 1);
    if (x + 1 < width) visit(index + 1);
    if (y > 0) visit(index - width);
    if (y + 1 < height) visit(index + width);
    if (z > 0) visit(index - plane);
    if (z + 1 < depth) visit(index + plane);
  };
  for (let z = 0; z < depth; z++) {
    for (let y = 0; y < height; y++) {
      const row = z * plane + y * width;
      if (z === 0 || z + 1 === depth || y === 0 || y + 1 === height) {
        for (let x = 0; x < width; x++) enqueueExterior(row + x);
      } else {
        enqueueExterior(row);
        enqueueExterior(row + width - 1);
      }
    }
  }
  for (let head = 0; head < tail; head++) neighbors(queue[head], enqueueExterior);
  tail = 0;
  for (let i = 0; i < colors.length; i++) if (colors[i]) queue[tail++] = i;
  let color = 0;
  const enqueueInterior = (index: number) => {
    if (colors[index] || exterior[index]) return;
    colors[index] = color;
    queue[tail++] = index;
  };
  for (let head = 0; head < tail; head++) {
    color = colors[queue[head]];
    neighbors(queue[head], enqueueInterior);
  }
}

export function voxelizeMesh(object: Object3D, { resolution = 32, mode = 'shell', frame = object }: Options = {}): SparseVoxelGrid {
  if (!Number.isInteger(resolution) || resolution < 4 || resolution > 128) throw new Error('体素分辨率须在 4–128 之间');
  object.updateWorldMatrix(true, true);
  frame.updateWorldMatrix(true, false);
  if (!frame.matrixWorld.determinant()) throw new Error('体素模型坐标系无效');
  const inverseFrame = frame.matrixWorld.clone().invert();
  const bounds = new Box3();
  forEachTriangle(object, inverseFrame, ({ a, b, c }) => { bounds.expandByPoint(a).expandByPoint(b).expandByPoint(c); });
  if (bounds.isEmpty()) throw new Error('所选对象没有可体素化的网格');
  const extents = bounds.getSize(new Vector3()).toArray();
  const voxelSize = Math.max(...extents) / resolution;
  if (!Number.isFinite(voxelSize) || voxelSize <= 0) throw new Error('所选对象的网格尺寸无效');
  const origin = bounds.min.toArray();
  const tolerance = voxelSize * 1e-8 + Math.max(...origin.map(Math.abs)) * Number.EPSILON * 4;
  const dimensions = extents.map((size) => Math.max(1, Math.min(resolution, Math.ceil(size / voxelSize - 1e-9)))) as Coordinates;
  const [width, height, depth] = dimensions;
  const plane = width * height;
  const colors = new Uint32Array(plane * depth);
  const distances = new Float32Array(colors.length);
  const box = new Box3();
  const center = new Vector3();
  const closest = new Vector3();
  const sampleColor = sampleColors();

  forEachTriangle(object, inverseFrame, (triangle, geometry, material, indices, tint) => {
    const { a, b, c } = triangle;
    const gridMin = (min: number, axis: number) => Math.max(0, Math.floor((min - origin[axis]) / voxelSize - 1e-9));
    const gridEnd = (max: number, axis: number) => Math.min(dimensions[axis], Math.floor((max - origin[axis]) / voxelSize + 1e-9) + 1);
    function raster(x: number, y: number, z: number, endX: number, endY: number, endZ: number) {
      const nx = endX - x;
      const ny = endY - y;
      const nz = endZ - z;
      if (nx <= 0 || ny <= 0 || nz <= 0) return;
      box.min.set(origin[0] + x * voxelSize - tolerance, origin[1] + y * voxelSize - tolerance, origin[2] + z * voxelSize - tolerance);
      box.max.set(origin[0] + endX * voxelSize + tolerance, origin[1] + endY * voxelSize + tolerance, origin[2] + endZ * voxelSize + tolerance);
      if (!box.intersectsTriangle(triangle)) return;
      if (nx >= ny && nx >= nz && nx > 1) {
        const mid = x + (nx >> 1);
        raster(x, y, z, mid, endY, endZ);
        raster(mid, y, z, endX, endY, endZ);
      } else if (ny >= nz && ny > 1) {
        const mid = y + (ny >> 1);
        raster(x, y, z, endX, mid, endZ);
        raster(x, mid, z, endX, endY, endZ);
      } else if (nz > 1) {
        const mid = z + (nz >> 1);
        raster(x, y, z, endX, endY, mid);
        raster(x, y, mid, endX, endY, endZ);
      } else {
        const index = x + y * width + z * plane;
        box.getCenter(center);
        triangle.closestPointToPoint(center, closest);
        const distance = center.distanceToSquared(closest);
        if (!colors[index] || distance < distances[index]) {
          distances[index] = distance;
          colors[index] = sampleColor(triangle, closest, geometry, material, indices, tint);
        }
      }
    }
    raster(gridMin(Math.min(a.x, b.x, c.x), 0), gridMin(Math.min(a.y, b.y, c.y), 1), gridMin(Math.min(a.z, b.z, c.z), 2),
      gridEnd(Math.max(a.x, b.x, c.x), 0), gridEnd(Math.max(a.y, b.y, c.y), 1), gridEnd(Math.max(a.z, b.z, c.z), 2));
  });

  if (mode === 'solid') fillInterior(colors, dimensions);
  const cells: Record<string, string> = {};
  for (let i = 0; i < colors.length; i++) {
    if (colors[i]) cells[`${i % width},${Math.floor(i / width) % height},${Math.floor(i / plane)}`] = `#${(colors[i] - 1).toString(16).padStart(6, '0')}`;
  }
  return { origin, dimensions, voxelSize, cells };
}

export function voxelSurfaceGeometry({ cells, origin, dimensions, voxelSize }: SparseVoxelGrid): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const [width, height, depth] = dimensions;
  const strides = [1, width, width * height];
  const grid = new Uint32Array(width * height * depth);
  const palette = [new Color()];
  const colorIds = new Map<string, number>();
  for (const [key, color] of Object.entries(cells)) {
    const [x, y, z] = key.split(',').map(Number);
    if (x < 0 || y < 0 || z < 0 || x >= width || y >= height || z >= depth) continue;
    let colorId = colorIds.get(color);
    if (!colorId) {
      colorId = palette.length;
      palette.push(new Color(color));
      colorIds.set(color, colorId);
    }
    grid[x + y * strides[1] + z * strides[2]] = colorId;
  }

  // Merge adjoining equal-color faces on each plane. Hit positions and axis normals remain exact.
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const cols = dimensions[u];
    const rows = dimensions[v];
    const mask = new Int32Array(cols * rows);
    const corner: Coordinates = [0, 0, 0];
    const normal: Coordinates = [0, 0, 0];
    for (let slice = 0; slice <= dimensions[axis]; slice++) {
      const after = slice * strides[axis];
      const hasBefore = slice > 0;
      const hasAfter = slice < dimensions[axis];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const offset = after + row * strides[v] + col * strides[u];
          const a = hasBefore ? grid[offset - strides[axis]] : 0;
          const b = hasAfter ? grid[offset] : 0;
          mask[row * cols + col] = a ? (b ? 0 : a) : -b;
        }
      }
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const start = row * cols + col;
          const face = mask[start];
          if (!face) continue;
          let endCol = col + 1;
          while (endCol < cols && mask[row * cols + endCol] === face) endCol++;
          let endRow = row + 1;
          nextRow: while (endRow < rows) {
            for (let x = col; x < endCol; x++) if (mask[endRow * cols + x] !== face) break nextRow;
            endRow++;
          }
          for (let y = row; y < endRow; y++) mask.fill(0, y * cols + col, y * cols + endCol);
          const base = positions.length / 3;
          const color = palette[Math.abs(face)];
          normal[axis] = Math.sign(face);
          corner[axis] = slice;
          for (const [x, y] of [[col, row], [endCol, row], [endCol, endRow], [col, endRow]]) {
            corner[u] = x;
            corner[v] = y;
            positions.push(origin[0] + corner[0] * voxelSize, origin[1] + corner[1] * voxelSize, origin[2] + corner[2] * voxelSize);
            normals.push(...normal);
            colors.push(color.r, color.g, color.b);
          }
          if (face > 0) indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          else indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
          col = endCol - 1;
        }
      }
    }
  }
  return new BufferGeometry().setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3))
    .setAttribute('normal', new BufferAttribute(Float32Array.from(normals), 3))
    .setAttribute('color', new BufferAttribute(Float32Array.from(colors), 3))
    .setIndex(indices);
}
