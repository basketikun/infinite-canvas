/**
 * Stage-mode asset palette. Browse the built-in catalog grouped by category,
 * filter by name, and arm click-to-place (the Viewport does the drop).
 * Also imports custom 3D models into the project.
 */

import { useEffect, useMemo, useState } from 'react'
import { ASSET_CATALOG, type AssetSpec } from '@engine/assets'
import type { EntityCategory } from '@engine/types'
import { sequenceStyles, type SequenceType } from '@engine/sequences'
import {
  choreoStyles,
  choreoEndings,
  choreoFormations,
  type ChoreoKind,
  type FormationId,
  type RoutineSpec
} from '@engine/choreography'
import { useStore } from '../store'
import { populateFromReference } from '../ai/populate'

interface PresetInfo {
  id: string
  name: string
  savedAt: string
  entityCount: number
}

/**
 * Globally persistent stage presets ("Dinner scene", "Driving scene"):
 * save the current staging once, reuse it as a starting point in any
 * project — applying stages a fresh copy, never touching the original.
 */
function StagePresets(): JSX.Element {
  const [presets, setPresets] = useState<PresetInfo[]>([])
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const saveStagePreset = useStore((s) => s.saveStagePreset)
  const applyStagePreset = useStore((s) => s.applyStagePreset)
  const scene = useStore((s) => s.doc?.scenes.find((sc) => sc.id === s.sceneId))
  const toast = useStore((s) => s.toast)

  const refresh = async (): Promise<void> => {
    try {
      setPresets(await window.blockout.presetsList())
    } catch {
      /* first run: presets dir may not exist yet */
    }
  }
  useEffect(() => {
    void refresh()
  }, [])

  const onSave = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) return
    await saveStagePreset(trimmed)
    setNaming(false)
    setName('')
    await refresh()
  }

  const onDelete = async (p: PresetInfo): Promise<void> => {
    await window.blockout.presetDelete(p.id)
    toast(`Preset "${p.name}" deleted.`, 'info')
    await refresh()
  }

  return (
    <div className="panel-section">
      <div className="panel-title">Stage Presets</div>
      {presets.length === 0 && !naming && (
        <div className="empty-hint" style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
          Save a staging you'll reuse — a dinner scene, a driving setup — and
          start from it in any project.
        </div>
      )}
      {presets.map((p) => (
        <div
          key={p.id}
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}
        >
          <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${p.entityCount} items · saved ${new Date(p.savedAt).toLocaleDateString()}`}>
            {p.name}
          </span>
          <button
            className="btn small"
            onClick={() => void applyStagePreset(p.id)}
            title="Stage this preset as a NEW scene — the preset itself stays untouched"
          >
            Stage
          </button>
          <button className="btn small" onClick={() => void onDelete(p)} title="Delete this preset">
            ✕
          </button>
        </div>
      ))}
      {naming ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input
            type="text"
            autoFocus
            placeholder="Preset name… e.g. Dinner scene"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onSave()
              if (e.key === 'Escape') setNaming(false)
            }}
            style={{ flex: 1 }}
          />
          <button className="btn small primary" onClick={() => void onSave()}>
            Save
          </button>
        </div>
      ) : (
        <button
          className="btn"
          style={{ width: '100%', marginTop: 6 }}
          disabled={(scene?.entities.length ?? 0) === 0}
          onClick={() => setNaming(true)}
          title="Save this scene's staging (set, characters, blocking) as a reusable preset available in every project"
        >
          ＋ Save current staging as preset
        </button>
      )}
    </div>
  )
}

/**
 * Sequence director: one click drops a whole choreographed crowd — a dance
 * number, a brawl, a foot chase, a car chase — sized and styled to taste,
 * staged where the viewport is looking.
 */
function Sequences(): JSX.Element {
  const [type, setType] = useState<SequenceType>('dance')
  const [count, setCount] = useState(12)
  const [style, setStyle] = useState('mixed')
  const placingSequence = useStore((s) => s.placingSequence)
  const setPlacingSequence = useStore((s) => s.setPlacingSequence)

  const styles = sequenceStyles(type)
  const activeStyle = styles.some((s) => s.id === style) ? style : styles[0]!.id

  const TYPE_LABELS: { id: SequenceType; label: string }[] = [
    { id: 'dance', label: '💃 Dance number' },
    { id: 'fight', label: '🥊 Fight' },
    { id: 'footChase', label: '🏃 Foot chase' },
    { id: 'carChase', label: '🚗 Car chase' }
  ]

  return (
    <div className="panel-section">
      <div className="panel-title">Sequences</div>
      <div className="field">
        <label>Type</label>
        <select value={type} onChange={(e) => setType(e.target.value as SequenceType)}>
          {TYPE_LABELS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <div className="field" style={{ flex: 1 }}>
          <label>Performers</label>
          <input
            type="number"
            min={2}
            max={60}
            value={count}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (!Number.isNaN(v)) setCount(Math.max(2, Math.min(60, Math.round(v))))
            }}
          />
        </div>
        <div className="field" style={{ flex: 2 }}>
          <label>Style</label>
          <select value={activeStyle} onChange={(e) => setStyle(e.target.value)}>
            {styles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button
        className={`btn primary${placingSequence ? ' active' : ''}`}
        style={{ width: '100%' }}
        onClick={() =>
          setPlacingSequence(placingSequence ? null : { type, count, style: activeStyle })
        }
        title="Arms placement — then click the floor exactly where you want the group. It stages there, facing the camera. Esc cancels. One undo step; every performer stays individually editable."
      >
        {placingSequence ? '⟳ Click the floor to place… (Esc cancels)' : `🎬 Stage ${count} performers`}
      </button>
    </div>
  )
}

const randomSeed = (): number => Math.floor(Math.random() * 1_000_000_000)

/**
 * Choreographer: author a staged routine (dance number, paired fight, chase)
 * and either spawn fresh performers (click the floor) or apply it to the
 * currently selected characters.
 */
function Choreographer(): JSX.Element {
  const [kind, setKind] = useState<ChoreoKind>('dance')
  const [style, setStyle] = useState('mixed')
  const [performers, setPerformers] = useState(8)
  const [duration, setDuration] = useState(8)
  const [bpm, setBpm] = useState(116)
  const [formation, setFormation] = useState<FormationId>('line')
  const [canon, setCanon] = useState(false)
  const [mirror, setMirror] = useState(false)
  const [formationChange, setFormationChange] = useState(false)
  const [ending, setEnding] = useState('finish')
  const [seed, setSeed] = useState(randomSeed)

  const placing = useStore((s) => s.placingChoreography)
  const setPlacing = useStore((s) => s.setPlacingChoreography)
  const choreographSelected = useStore((s) => s.choreographSelected)
  const selection = useStore((s) => s.selection)
  const toast = useStore((s) => s.toast)

  const styles = choreoStyles(kind)
  const activeStyle = styles.some((s) => s.id === style) ? style : styles[0]!.id
  const endings = choreoEndings(kind)
  const activeEnding = endings.some((e) => e.id === ending) ? ending : endings[0]!.id

  const spec = (): RoutineSpec => ({
    kind,
    performers,
    durationS: duration,
    seed,
    bpm,
    style: activeStyle,
    formation,
    canon,
    mirror,
    formationChange,
    ending: activeEnding
  })

  const selCount =
    selection?.kind === 'entities' ? selection.entityIds.length : selection?.kind === 'entity' ? 1 : 0

  const onApply = (): void => {
    if (selCount === 0) {
      toast('Select the performers to choreograph first.', 'info')
      return
    }
    if (!window.confirm(`Replace the choreography of ${selCount} selected performer${selCount > 1 ? 's' : ''}?`))
      return
    choreographSelected(spec())
  }

  const KIND_LABELS: { id: ChoreoKind; label: string }[] = [
    { id: 'dance', label: '💃 Dance number' },
    { id: 'fight', label: '🥋 Fight' },
    { id: 'chase', label: '🏃 Chase' }
  ]

  return (
    <div className="panel-section">
      <div className="panel-title">Choreographer</div>
      <div className="field">
        <label>Routine</label>
        <select value={kind} onChange={(e) => setKind(e.target.value as ChoreoKind)}>
          {KIND_LABELS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <div className="field" style={{ flex: 2 }}>
          <label>Style</label>
          <select value={activeStyle} onChange={(e) => setStyle(e.target.value)}>
            {styles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Performers</label>
          <input
            type="number"
            min={kind === 'dance' ? 1 : 2}
            max={kind === 'dance' ? 40 : kind === 'fight' ? 8 : 6}
            value={performers}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (!Number.isNaN(v)) setPerformers(Math.max(1, Math.round(v)))
            }}
          />
        </div>
      </div>
      <div className="field-row">
        <div className="field" style={{ flex: 1 }}>
          <label>Duration (s)</label>
          <input
            type="number"
            min={2}
            max={60}
            value={duration}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (!Number.isNaN(v)) setDuration(Math.max(2, Math.min(60, Math.round(v))))
            }}
          />
        </div>
        {kind === 'dance' && (
          <div className="field" style={{ flex: 1 }}>
            <label>BPM</label>
            <input
              type="number"
              min={60}
              max={180}
              value={bpm}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (!Number.isNaN(v)) setBpm(Math.max(60, Math.min(180, Math.round(v))))
              }}
            />
          </div>
        )}
        {(kind === 'fight' || kind === 'chase') && (
          <div className="field" style={{ flex: 2 }}>
            <label>Ending</label>
            <select value={activeEnding} onChange={(e) => setEnding(e.target.value)}>
              {endings.map((en) => (
                <option key={en.id} value={en.id}>
                  {en.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {kind === 'dance' && (
        <>
          <div className="field">
            <label>Formation</label>
            <select value={formation} onChange={(e) => setFormation(e.target.value as FormationId)}>
              {choreoFormations().map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row" style={{ gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <input type="checkbox" checked={canon} onChange={(e) => setCanon(e.target.checked)} /> Canon
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> Mirror
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={formationChange}
                onChange={(e) => setFormationChange(e.target.checked)}
              />{' '}
              Formations
            </label>
          </div>
        </>
      )}
      {kind === 'fight' && (
        <div className="field-row" style={{ gap: 12, marginBottom: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> Mirror stance
          </label>
        </div>
      )}
      <div className="field">
        <label>Seed</label>
        <div className="field-row" style={{ gap: 6 }}>
          <input
            type="number"
            style={{ flex: 1 }}
            value={seed}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (!Number.isNaN(v)) setSeed(Math.max(0, Math.round(v)))
            }}
          />
          <button className="btn small" title="Reroll the seed" onClick={() => setSeed(randomSeed())}>
            🎲
          </button>
        </div>
      </div>
      <button
        className={`btn primary${placing ? ' active' : ''}`}
        style={{ width: '100%', marginBottom: 6 }}
        onClick={() => setPlacing(placing ? null : spec())}
        title="Arm placement — then click the floor where the routine should stage, facing the camera. Esc cancels. One undo step; every performer stays editable."
      >
        {placing ? '⟳ Click the floor to place… (Esc cancels)' : '🎬 Spawn routine'}
      </button>
      <button
        className="btn"
        style={{ width: '100%' }}
        onClick={onApply}
        title="Replace the choreography of the selected performers with this routine (keeps their look)."
      >
        {selCount > 0 ? `Apply to ${selCount} selected` : 'Apply to selection'}
      </button>
    </div>
  )
}

/** Emoji thumb per catalog id. '📦' is the fallback for anything unmapped. */
const THUMBS: Record<string, string> = {
  // People
  'person.man': '🚶',
  'person.woman': '👩',
  'person.child': '🧒',
  'person.elderly': '🧓',
  // Animals
  'animal.dog': '🐕',
  'animal.cat': '🐈',
  'animal.horse': '🐎',
  'animal.bird': '🐦',
  // Vehicles
  'vehicle.sedan': '🚗',
  'vehicle.suv': '🚙',
  'vehicle.pickup': '🛻',
  'vehicle.van': '🚐',
  'vehicle.bus': '🚌',
  'vehicle.truck': '🚚',
  'vehicle.tank': '🪖',
  'vehicle.train': '🚆',
  'vehicle.motorcycle': '🏍',
  'vehicle.bicycle': '🚲',
  'vehicle.plane': '✈️',
  'vehicle.boat': '🛥',
  // Furniture & props
  'furniture.bed': '🛏',
  'furniture.couch': '🛋',
  'furniture.armchair': '🛋',
  'furniture.diningTable': '🍽',
  'furniture.kitchenTable': '🍽',
  'furniture.desk': '🖥',
  'furniture.sideTable': '🪵',
  'furniture.lamp': '💡',
  'furniture.chair': '🪑',
  'furniture.stool': '🪑',
  'furniture.bar': '🍸',
  'furniture.counter': '🍳',
  'furniture.shelf': '🗄',
  'furniture.tv': '📺',
  'furniture.tableSetting': '🍽',
  'furniture.door': '🚪',
  'furniture.window': '🪟',
  'furniture.fridge': '🧊',
  'furniture.stove': '🍳',
  'furniture.sinkCounter': '🚰',
  'furniture.toilet': '🚽',
  'furniture.bathtub': '🛁',
  'furniture.showerStall': '🚿',
  'furniture.officeChair': '🪑',
  'furniture.filingCabinet': '🗄',
  'furniture.whiteboard': '📋',
  'furniture.podium': '🎤',
  'furniture.monitor': '🖥',
  'furniture.pianoUpright': '🎹',
  'furniture.poolTable': '🎱',
  'furniture.hospitalBed': '🛏',
  'furniture.wheelchair': '🦽',
  'furniture.crib': '🍼',
  'furniture.fireplace': '🔥',
  'furniture.chandelier': '💡',
  'furniture.rug': '🟫',
  'furniture.curtain': '🪟',
  'furniture.bookshelfFull': '📚',
  'furniture.doorOpen': '🚪',
  // Props
  'prop.phone': '📱',
  'prop.laptop': '💻',
  'prop.cup': '🥤',
  'prop.mug': '☕',
  'prop.bowl': '🥣',
  'prop.plate': '🍽',
  'prop.bottle': '🍾',
  'prop.wineglass': '🍷',
  'prop.book': '📕',
  'prop.newspaper': '📰',
  'prop.briefcase': '💼',
  'prop.suitcase': '🧳',
  'prop.backpack': '🎒',
  'prop.umbrella': '🌂',
  'prop.hat': '🎩',
  'prop.baseballBat': '🏏',
  'prop.sword': '🗡',
  'prop.torch': '🔦',
  'prop.candle': '🕯',
  'prop.lantern': '🏮',
  'prop.pictureFrame': '🖼',
  'prop.poster': '📃',
  'prop.mirror': '🪞',
  'prop.clock': '🕐',
  'prop.ball': '⚽',
  'prop.balloon': '🎈',
  'prop.microphone': '🎤',
  'prop.guitar': '🎸',
  'prop.camera': '🎥',
  'prop.tripod': '📷',
  'prop.tree': '🌳',
  'prop.bush': '🌿',
  'prop.rock': '🪨',
  'prop.streetlightSingle': '🏮',
  'prop.trafficLight': '🚦',
  'prop.stopSign': '🛑',
  'prop.fireHydrant': '🧯',
  'prop.mailbox': '📮',
  'prop.trashcan': '🗑',
  'prop.dumpster': '🗑',
  'prop.trafficCone': '🚧',
  'prop.barrier': '🚧',
  'prop.fence': '🚧',
  'prop.bench': '🪑',
  'prop.phoneBooth': '☎️',
  'prop.atm': '🏧',
  'prop.vendingMachine': '🥤',
  'prop.shoppingCart': '🛒',
  'prop.ladder': '🪜',
  'prop.scaffold': '🏗',
  'prop.crate': '📦',
  'prop.barrel': '🛢',
  'prop.pallet': '🪵',
  'prop.tent': '⛺',
  'prop.campfire': '🔥',
  'prop.poolWater': '💧',
  'prop.fountain': '⛲',
  'prop.flagpole': '🚩',
  'prop.helicopter': '🚁',
  // Props — backyard / recreation
  'prop.hotTub': '🛁',
  'prop.bbqGrill': '🍖',
  'prop.firepit': '🔥',
  'prop.poolLounger': '🏖',
  'prop.patioUmbrellaTable': '⛱',
  'prop.picnicTable': '🧺',
  'prop.swingSet': '🎠',
  'prop.slide': '🛝',
  'prop.seesaw': '🪅',
  'prop.sandbox': '🏖',
  'prop.trampoline': '🤸',
  'prop.kiddiePool': '💧',
  'prop.basketballHoop': '🏀',
  'prop.soccerGoal': '🥅',
  'prop.doghouse': '🐕',
  'prop.shed': '🛖',
  'prop.gazebo': '⛺',
  'prop.hammock': '🌴',
  'prop.lawnmower': '🚜',
  // Props — commercial / street
  'prop.cashRegister': '🧾',
  'prop.kiosk': '🏪',
  'prop.gasPump': '⛽',
  'prop.parkingMeter': '🅿️',
  'prop.busShelter': '🚏',
  'prop.slotMachine': '🎰',
  'prop.cloud': '☁️',
  'prop.squirtGun': '🔫',
  // Environments
  'env.houseInterior': '🏠',
  'env.houseExterior': '🏡',
  'env.cityStreet': '🏙',
  'env.store': '🏪',
  'env.nightclub': '🪩',
  'env.office': '🏢',
  'env.warehouse': '🏭',
  'env.carInterior': '💺',
  'env.busInterior': '💺',
  'env.planeCabin': '✈️',
  'env.field': '🌾',
  'env.desert': '🏜',
  'env.parkingLot': '🅿️',
  'env.alley': '🌃',
  'env.rooftop': '🏙',
  'env.restaurant': '🍽',
  'env.hospitalRoom': '🏥',
  'env.classroom': '🏫',
  'env.gym': '🏋',
  'env.courtroom': '⚖️',
  'env.subwayPlatform': '🚇',
  'env.beach': '🏖',
  'env.forest': '🌲',
  'env.bar': '🍺',
  'env.stage': '🎭',
  // Environments — round 5 interiors
  'env.trainInterior': '🚃',
  'env.boatInterior': '⛵',
  'env.postOffice': '📮',
  'env.supermarket': '🛒',
  'env.movieTheater': '🎬',
  'env.indoorMall': '🛍',
  'env.hotelLobby': '🏨',
  'env.hotelRoom': '🛎',
  'env.diner': '🍔',
  'env.coffeeShop': '☕',
  'env.policeStation': '🚓',
  'env.church': '⛪',
  'env.schoolHallway': '🏫',
  'env.airportTerminal': '🛫',
  'env.casino': '🎰',
  'env.parkingGarage': '🅿️',
  // Environments — round 5 exteriors
  'env.stripMall': '🏬',
  'env.outdoorMall': '🛍',
  'env.residentialStreet': '🏘',
  'env.downtown': '🌆',
  'env.trainStation': '🚉',
  'env.gasStation': '⛽',
  'env.park': '🏞',
  'env.playgroundPark': '🛝',
  'env.backyard': '🏡',
  'env.constructionSite': '🏗',
  'env.cemetery': '🪦',
  'env.stadium': '🏟',
  'env.sky': '☁️',
  'env.houseFull': '🏠',
  // Primitives
  'prim.cube': '⬜',
  'prim.cylinder': '⚪',
  'prim.ramp': '📐',
  'prim.wall': '🧱',
  'prim.stairs': '🪜'
}

function thumbFor(id: string): string {
  return THUMBS[id] ?? '📦'
}

/** Fixed display order of categories with human-readable titles. */
const CATEGORY_ORDER: { key: EntityCategory; title: string }[] = [
  { key: 'people', title: 'People' },
  { key: 'animals', title: 'Animals' },
  { key: 'vehicles', title: 'Vehicles' },
  { key: 'furniture', title: 'Furniture' },
  { key: 'props', title: 'Props' },
  { key: 'environment', title: 'Environments' },
  { key: 'primitives', title: 'Primitives' }
]

export function Library(): JSX.Element {
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<EntityCategory | 'all'>('all')
  const [collapsed, setCollapsed] = useState<Partial<Record<EntityCategory, boolean>>>({})
  const placingAssetId = useStore((s) => s.placingAssetId)
  const setPlacingAsset = useStore((s) => s.setPlacingAsset)
  const addEntity = useStore((s) => s.addEntity)
  const mutate = useStore((s) => s.mutate)
  const projectFolder = useStore((s) => s.projectFolder)
  const importScan = useStore((s) => s.importScan)
  const toast = useStore((s) => s.toast)

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = (a: AssetSpec): boolean =>
      q === '' ||
      a.name.toLowerCase().includes(q) ||
      a.category.toLowerCase().includes(q)
    return CATEGORY_ORDER.filter(
      ({ key }) => categoryFilter === 'all' || key === categoryFilter
    ).map(({ key, title }) => ({
      key,
      title,
      items: ASSET_CATALOG.filter((a) => a.category === key && matches(a))
    })).filter((g) => g.items.length > 0)
  }, [query, categoryFilter])

  const toggleCollapsed = (key: EntityCategory): void =>
    setCollapsed((c) => ({ ...c, [key]: !c[key] }))

  const onPick = (id: string): void => {
    if (placingAssetId === id) setPlacingAsset(null)
    else setPlacingAsset(id)
  }

  const onImportScan = async (): Promise<void> => {
    const path = await window.blockout.pickFile([
      { name: '3D Scans (Gaussian splats)', extensions: ['ply', 'splat', 'ksplat', 'spz'] }
    ])
    if (!path) return
    await importScan(path)
  }

  const onImport = async (): Promise<void> => {
    const path = await window.blockout.pickFile([
      { name: '3D Models', extensions: ['glb', 'gltf', 'obj'] }
    ])
    if (!path) return
    if (!projectFolder) {
      toast('Open or save a project before importing models.', 'error')
      return
    }
    try {
      const result = await window.blockout.importAsset(projectFolder, path)
      const entityId = addEntity(`custom.${result.name}`, { x: 0, y: 0, z: 0 })
      mutate('import model', (doc) => {
        for (const scene of doc.scenes) {
          const entity = scene.entities.find((e) => e.id === entityId)
          if (entity) {
            entity.sourceFile = result.relativePath
            break
          }
        }
      })
      toast(`Imported ${result.name}`, 'success')
    } catch (e) {
      toast(`Import failed: ${(e as Error).message}`, 'error')
    }
  }

  return (
    <>
      <Sequences />
      <Choreographer />
      <StagePresets />

      <div className="library-search">
        <input
          type="text"
          placeholder="Search assets…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* Browse controls: filter to one category, or place from a list. */}
      <div className="panel-section" style={{ paddingBottom: 4 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as EntityCategory | 'all')}
            title="Show one category at a time"
          >
            <option value="all">All categories</option>
            {CATEGORY_ORDER.map((c) => (
              <option key={c.key} value={c.key}>
                {c.title}
              </option>
            ))}
          </select>
          <select
            value={placingAssetId && ASSET_CATALOG.some((a) => a.id === placingAssetId) ? placingAssetId : ''}
            onChange={(e) => setPlacingAsset(e.target.value || null)}
            title="Pick from the full list — then click the floor to place it"
          >
            <option value="">Place from list…</option>
            {CATEGORY_ORDER.map((c) => (
              <optgroup key={c.key} label={c.title}>
                {ASSET_CATALOG.filter((a) => a.category === c.key).map((a) => (
                  <option key={a.id} value={a.id}>
                    {thumbFor(a.id)} {a.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      {groups.map((group) => (
        <div className="panel-section" key={group.key}>
          <div
            className="panel-title"
            style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', justifyContent: 'space-between' }}
            onClick={() => toggleCollapsed(group.key)}
            title={collapsed[group.key] ? 'Expand' : 'Collapse'}
          >
            <span>
              {group.title} <span style={{ opacity: 0.5 }}>({group.items.length})</span>
            </span>
            <span style={{ opacity: 0.6 }}>{collapsed[group.key] ? '▸' : '▾'}</span>
          </div>
          {collapsed[group.key] ? null : (
            <div className="library-grid">
              {group.items.map((asset) => (
                <div
                  key={asset.id}
                  className={`library-item${placingAssetId === asset.id ? ' placing' : ''}`}
                  onClick={() => onPick(asset.id)}
                >
                  <span className="thumb">{thumbFor(asset.id)}</span>
                  <span className="name">{asset.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="panel-section">
        <button
          className="btn primary"
          style={{ width: '100%', marginBottom: 8 }}
          onClick={() => void populateFromReference()}
          title="Give Claude a reference photo or video frame — it stages the scene to match: people, furniture, poses, lighting, and a camera to match the framing"
        >
          ✨ Populate from reference…
        </button>
        <button className="btn" style={{ width: '100%', marginBottom: 8 }} onClick={() => void onImport()}>
          Import 3D Model…
        </button>
        <button
          className="btn"
          style={{ width: '100%' }}
          onClick={() => void onImportScan()}
          title="Load a Gaussian-splat scan of a real location (.ply/.splat/.ksplat/.spz) and block your scene inside it. Scan with any phone app (Polycam, Luma, Scaniverse) or a video-to-3D tool. Editor staging only — scans never appear in exports."
        >
          🏙 Import 3D Scan…
        </button>
        <p style={{ color: 'var(--text-faint)', fontSize: 10.5, lineHeight: 1.4, margin: '6px 0 0' }}>
          Scans: phone-capture a real location, then stage and block inside it.
        </p>
      </div>
    </>
  )
}
