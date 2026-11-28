import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BoxGeometry, Color, DataTexture, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, RGBAFormat, SRGBColorSpace, Vector3 } from 'three';
import { voxelSurfaceGeometry, voxelizeMesh } from '../src/lib/voxelize-mesh';

test('voxelizes a transformed mesh relative to the requested editing frame', () => {
  const parent = new Group();
  parent.position.set(30, 4, -12);
  parent.rotation.y = Math.PI / 3;
  parent.scale.setScalar(3);
  const selected = new Group();
  selected.position.set(5, 1, 3);
  parent.add(selected);
  const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial({ color: '#c06030' }));
  mesh.position.set(2, 3, -1);
  selected.add(mesh);

  const shell = voxelizeMesh(selected, { resolution: 16 });
  assert.ok(new Vector3(...shell.origin).distanceTo(new Vector3(1, 2, -2)) < 1e-9);
  assert.deepEqual(shell.dimensions, [16, 16, 16]);
  assert.equal(Object.keys(shell.cells).length, 16 ** 3 - 14 ** 3);
  assert.equal(shell.cells['8,8,8'], undefined);
  assert.equal(shell.cells['0,8,8'], '#c06030');

  const solid = voxelizeMesh(selected, { resolution: 16, mode: 'solid', frame: parent });
  assert.ok(new Vector3(...solid.origin).distanceTo(new Vector3(6, 3, 1)) < 1e-9);
  assert.equal(Object.keys(solid.cells).length, 16 ** 3);
  assert.equal(solid.cells['8,8,8'], '#c06030');
});

test('samples color textures and does not extend an open face in solid mode', () => {
  const map = new DataTexture(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]), 2, 1, RGBAFormat);
  map.colorSpace = SRGBColorSpace;
  const mesh = new Mesh(new PlaneGeometry(2, 1), new MeshBasicMaterial({ map }));
  const grid = voxelizeMesh(mesh, { resolution: 16, mode: 'solid' });
  assert.deepEqual(grid.dimensions, [16, 8, 1]);
  assert.equal(Object.keys(grid.cells).length, 16 * 8);
  assert.equal(grid.cells['2,2,0'], '#ff0000');
  assert.equal(grid.cells['14,2,0'], '#0000ff');
});

test('honors instance transforms and colors', () => {
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 2);
  mesh.setMatrixAt(0, new Matrix4().makeTranslation(-1.5, 0, 0));
  mesh.setMatrixAt(1, new Matrix4().makeTranslation(1.5, 0, 0));
  mesh.setColorAt(0, new Color('#ff0000'));
  mesh.setColorAt(1, new Color('#0000ff'));
  const grid = voxelizeMesh(mesh, { resolution: 16 });
  assert.deepEqual(grid.origin, [-2, -0.5, -0.5]);
  assert.equal(grid.cells['0,0,0'], '#ff0000');
  assert.equal(grid.cells['15,0,0'], '#0000ff');
  assert.equal(grid.cells['8,0,0'], undefined);
});

test('renders only exposed quads with correctly oriented normals and linear vertex colors', () => {
  const geometry = voxelSurfaceGeometry({ origin: [2, 3, 4], dimensions: [2, 1, 1], voxelSize: 0.5,
    cells: { '0,0,0': '#808080', '1,0,0': '#ff0000' } });
  const { position, normal, color } = geometry.attributes;
  assert.equal(position.count, 10 * 4);
  assert.equal(geometry.index?.count, 10 * 6);
  assert.ok(Math.abs(color.getX(0) - new Color('#808080').r) < 1e-6);
  geometry.computeBoundingBox();
  assert.deepEqual(geometry.boundingBox?.min.toArray(), [2, 3, 4]);
  assert.deepEqual(geometry.boundingBox?.max.toArray(), [3, 3.5, 4.5]);
  for (let i = 0; i < geometry.index!.count; i += 6) {
    const first = geometry.index!.getX(i);
    const a = new Vector3().fromBufferAttribute(position, first);
    const b = new Vector3().fromBufferAttribute(position, geometry.index!.getX(i + 1));
    const c = new Vector3().fromBufferAttribute(position, geometry.index!.getX(i + 2));
    assert.ok(b.sub(a).cross(c.sub(a)).normalize().dot(new Vector3().fromBufferAttribute(normal, first)) > 0.99);
  }
  const merged = voxelSurfaceGeometry({ origin: [0, 0, 0], dimensions: [2, 1, 1], voxelSize: 1, cells: { '0,0,0': '#ffffff', '1,0,0': '#ffffff' } });
  assert.equal(merged.index?.count, 6 * 6);
  assert.throws(() => voxelizeMesh(new Group()), /没有可体素化/);
  assert.throws(() => voxelizeMesh(new Group(), { resolution: 129 }), /分辨率/);
});
