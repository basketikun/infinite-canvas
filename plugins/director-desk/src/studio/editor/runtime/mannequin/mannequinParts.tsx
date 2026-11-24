interface HumanoidMaterialProps {
  color: string;
}

interface SegmentProps {
  color: string;
  length: number;
  name?: string;
  position: [number, number, number];
  radius: number;
  rotation?: [number, number, number];
  scale?: [number, number, number];
}

interface JointProps {
  color: string;
  name?: string;
  position: [number, number, number];
  radius: number;
  scale?: [number, number, number];
}

interface HandProps {
  color: string;
  position: [number, number, number];
  radius: number;
  scale: [number, number, number];
  side: "left" | "right";
}

interface FootProps {
  color: string;
  length: number;
  position: [number, number, number];
  radius: number;
  scale: [number, number, number];
  side: "left" | "right";
}

interface TorsoProps {
  abdomenPosition: [number, number, number];
  abdomenScale: [number, number, number];
  chestPosition: [number, number, number];
  chestScale: [number, number, number];
  color: string;
  pelvisPosition: [number, number, number];
  pelvisRadius: number;
  pelvisScale: [number, number, number];
  torsoLowerHeight: number;
  torsoLowerRadius: number;
  torsoUpperHeight: number;
  torsoUpperRadius: number;
}

interface HeadProps {
  color: string;
  eyeRadius: number;
  faceOffsetZ: number;
  headRadius: number;
  headScale: [number, number, number];
  mouthScale: [number, number, number];
  neckHeight: number;
  neckPosition: [number, number, number];
  neckRadius: number;
  noseScale: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
}

export function HumanoidMaterial({ color }: HumanoidMaterialProps) {
  return <meshStandardMaterial color={color} metalness={0.04} roughness={0.74} />;
}

function DetailMaterial() {
  return <meshStandardMaterial color="#070A0F" metalness={0.02} roughness={0.82} />;
}

export function Segment({ color, length, name, position, radius, rotation, scale = [1, 1, 1] }: SegmentProps) {
  return (
    <mesh name={name} position={position} rotation={rotation} scale={scale}>
      <capsuleGeometry args={[radius, length, 12, 22]} />
      <HumanoidMaterial color={color} />
    </mesh>
  );
}

export function Joint({ color, name = "humanoid-joint", position, radius, scale = [1, 1, 1] }: JointProps) {
  return (
    <mesh name={name} position={position} scale={scale}>
      <sphereGeometry args={[radius, 18, 18]} />
      <HumanoidMaterial color={color} />
    </mesh>
  );
}

export function Hand({ color, position, radius, scale, side }: HandProps) {
  const sideSign = side === "left" ? -1 : 1;

  return (
    <group position={position} scale={scale}>
      <mesh name={side === "left" ? "humanoid-left-hand" : "humanoid-right-hand"}>
        <sphereGeometry args={[radius, 18, 18]} />
        <HumanoidMaterial color={color} />
      </mesh>
      <mesh
        name={side === "left" ? "humanoid-left-thumb" : "humanoid-right-thumb"}
        position={[sideSign * radius * 0.76, -radius * 0.12, radius * 0.36]}
        rotation={[0.18, 0, sideSign * 0.72]}
        scale={[0.58, 0.85, 0.52]}
      >
        <capsuleGeometry args={[radius * 0.24, radius * 0.62, 8, 12]} />
        <HumanoidMaterial color={color} />
      </mesh>
      <mesh
        name={side === "left" ? "humanoid-left-fingers" : "humanoid-right-fingers"}
        position={[0, -radius * 0.44, radius * 0.22]}
        rotation={[0.18, 0, 0]}
        scale={[1.12, 0.56, 0.48]}
      >
        <capsuleGeometry args={[radius * 0.34, radius * 0.7, 8, 12]} />
        <HumanoidMaterial color={color} />
      </mesh>
    </group>
  );
}

export function Foot({ color, length, position, radius, scale, side }: FootProps) {
  return (
    <group position={position}>
      <mesh name={side === "left" ? "humanoid-left-foot" : "humanoid-right-foot"} rotation={[Math.PI / 2, 0, 0]} scale={scale}>
        <capsuleGeometry args={[radius, length, 12, 18]} />
        <HumanoidMaterial color={color} />
      </mesh>
      <mesh
        name={side === "left" ? "humanoid-left-toe-cap" : "humanoid-right-toe-cap"}
        position={[0, -radius * 0.04, length * 0.48]}
        scale={[scale[0] * 0.92, scale[1] * 0.72, scale[2] * 0.48]}
      >
        <sphereGeometry args={[radius, 16, 12]} />
        <HumanoidMaterial color={color} />
      </mesh>
    </group>
  );
}

export function Torso({
  abdomenPosition,
  abdomenScale,
  chestPosition,
  chestScale,
  color,
  pelvisPosition,
  pelvisRadius,
  pelvisScale,
  torsoLowerHeight,
  torsoLowerRadius,
  torsoUpperHeight,
  torsoUpperRadius,
}: TorsoProps) {
  const chestRingRadius = torsoUpperRadius * chestScale[0] * 0.78;
  const waistRingRadius = torsoLowerRadius * abdomenScale[0] * 0.92;

  return (
    <>
      <mesh name="humanoid-chest" position={chestPosition} scale={chestScale}>
        <capsuleGeometry args={[torsoUpperRadius, torsoUpperHeight, 18, 28]} />
        <HumanoidMaterial color={color} />
      </mesh>
      <mesh
        name="humanoid-chest-seam"
        position={[chestPosition[0], chestPosition[1] - torsoUpperHeight * 0.38, chestPosition[2]]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[1, chestScale[2] / chestScale[0], 1]}
      >
        <torusGeometry args={[chestRingRadius, Math.max(torsoUpperRadius * 0.028, 0.006), 8, 40]} />
        <DetailMaterial />
      </mesh>
      <mesh name="humanoid-abdomen" position={abdomenPosition} scale={abdomenScale}>
        <capsuleGeometry args={[torsoLowerRadius, torsoLowerHeight, 16, 24]} />
        <HumanoidMaterial color={color} />
      </mesh>
      <mesh
        name="humanoid-waist-seam"
        position={[abdomenPosition[0], abdomenPosition[1] - torsoLowerHeight * 0.46, abdomenPosition[2]]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[1, abdomenScale[2] / abdomenScale[0], 1]}
      >
        <torusGeometry args={[waistRingRadius, Math.max(torsoLowerRadius * 0.026, 0.005), 8, 40]} />
        <DetailMaterial />
      </mesh>
      <mesh name="humanoid-pelvis" position={pelvisPosition} scale={pelvisScale}>
        <sphereGeometry args={[pelvisRadius, 24, 20]} />
        <HumanoidMaterial color={color} />
      </mesh>
    </>
  );
}

export function Head({
  color,
  eyeRadius,
  faceOffsetZ,
  headRadius,
  headScale,
  mouthScale,
  neckHeight,
  neckPosition,
  neckRadius,
  noseScale,
  position,
  rotation,
}: HeadProps) {
  const eyeY = headRadius * 0.16;
  const eyeX = headRadius * 0.26;
  const faceZ = faceOffsetZ + headRadius * 0.08;

  return (
    <>
      <mesh name="humanoid-neck" position={neckPosition}>
        <cylinderGeometry args={[neckRadius * 0.9, neckRadius, neckHeight, 18]} />
        <HumanoidMaterial color={color} />
      </mesh>
      <group position={position} rotation={rotation}>
        <mesh name="humanoid-head" scale={headScale}>
          <sphereGeometry args={[headRadius, 28, 24]} />
          <HumanoidMaterial color={color} />
        </mesh>
        <mesh name="humanoid-face-muzzle" position={[0, -headRadius * 0.08, faceOffsetZ]} scale={[0.7, 0.52, 0.25]}>
          <sphereGeometry args={[headRadius * 0.38, 16, 12]} />
          <HumanoidMaterial color={color} />
        </mesh>
        <mesh name="humanoid-left-eye" position={[-eyeX, eyeY, faceZ]} scale={[1, 0.58, 0.32]}>
          <sphereGeometry args={[eyeRadius, 10, 8]} />
          <DetailMaterial />
        </mesh>
        <mesh name="humanoid-right-eye" position={[eyeX, eyeY, faceZ]} scale={[1, 0.58, 0.32]}>
          <sphereGeometry args={[eyeRadius, 10, 8]} />
          <DetailMaterial />
        </mesh>
        <mesh name="humanoid-nose" position={[0, -headRadius * 0.04, faceZ + headRadius * 0.05]} scale={noseScale}>
          <sphereGeometry args={[headRadius * 0.11, 12, 10]} />
          <HumanoidMaterial color={color} />
        </mesh>
        <mesh name="humanoid-mouth" position={[0, -headRadius * 0.24, faceZ + headRadius * 0.025]} scale={mouthScale}>
          <sphereGeometry args={[headRadius * 0.12, 12, 8]} />
          <DetailMaterial />
        </mesh>
      </group>
    </>
  );
}
