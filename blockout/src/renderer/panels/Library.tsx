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
import { uiText, useBlockoutI18n } from '../i18n'
import { CustomSelect } from '../components/CustomSelect'

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
  const { t } = useBlockoutI18n()
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
    toast(`预设“${p.name}”已删除。`, 'info')
    await refresh()
  }

  return (
    <div className="panel-section">
      <div className="panel-title">{t('library.presets')}</div>
      {presets.length === 0 && !naming && (
        <div className="empty-hint" style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
          保存一套可重复使用的布景，例如晚餐场景或驾驶场景，之后可在任何项目中继续使用。
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
            title="将此预设作为新场景布置，预设本身不会改变"
          >
            布置
          </button>
          <button className="btn small" onClick={() => void onDelete(p)} title="删除此预设">
            ✕
          </button>
        </div>
      ))}
      {naming ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input
            type="text"
            autoFocus
            placeholder="预设名称，例如：晚餐场景"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onSave()
              if (e.key === 'Escape') setNaming(false)
            }}
            style={{ flex: 1 }}
          />
          <button className="btn small primary" onClick={() => void onSave()}>
            保存
          </button>
        </div>
      ) : (
        <button
          className="btn"
          style={{ width: '100%', marginTop: 6 }}
          disabled={(scene?.entities.length ?? 0) === 0}
          onClick={() => setNaming(true)}
          title="将当前场景布置（场景、角色、走位）保存为可在所有项目中使用的预设"
        >
          ＋ 将当前布景保存为预设
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
  const { t } = useBlockoutI18n()
  const [type, setType] = useState<SequenceType>('dance')
  const [count, setCount] = useState(12)
  const [style, setStyle] = useState('mixed')
  const placingSequence = useStore((s) => s.placingSequence)
  const setPlacingSequence = useStore((s) => s.setPlacingSequence)

  const styles = sequenceStyles(type)
  const activeStyle = styles.some((s) => s.id === style) ? style : styles[0]!.id

  const TYPE_LABELS: { id: SequenceType; label: string }[] = [
    { id: 'dance', label: `💃 ${uiText('Dance number')}` },
    { id: 'fight', label: `🥊 ${uiText('Fight')}` },
    { id: 'footChase', label: `🏃 ${uiText('Foot chase')}` },
    { id: 'carChase', label: `🚗 ${uiText('Car chase')}` }
  ]

  return (
    <div className="panel-section">
      <div className="panel-title">{t('library.sequences')}</div>
      <div className="field">
        <label>{t('library.type')}</label>
        <CustomSelect
          value={type}
          onChange={(value) => setType(value as SequenceType)}
          options={TYPE_LABELS.map((item) => ({ value: item.id, label: item.label }))}
        />
      </div>
      <div className="field-row">
        <div className="field" style={{ flex: 1 }}>
          <label>{t('library.performers')}</label>
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
          <label>{t('library.style')}</label>
          <CustomSelect
            value={activeStyle}
            onChange={setStyle}
            options={styles.map((s) => ({ value: s.id, label: uiText(s.name) }))}
          />
        </div>
      </div>
      <button
        className={`btn primary${placingSequence ? ' active' : ''}`}
        style={{ width: '100%' }}
        onClick={() =>
          setPlacingSequence(placingSequence ? null : { type, count, style: activeStyle })
        }
        title="进入放置状态后点击地面布置队伍，队伍会面向相机；按 Esc 取消。每位表演者仍可单独编辑。"
      >
        {placingSequence ? `⟳ ${t('library.placeSequence')}` : `🎬 ${t('library.stageCount', 'Stage {{count}} performers', { count })}`}
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
  const { t } = useBlockoutI18n()
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
      toast('请先选择要编排的表演者。', 'info')
      return
    }
    if (!window.confirm(`替换已选 ${selCount} 名表演者的编舞？`))
      return
    choreographSelected(spec())
  }

  const KIND_LABELS: { id: ChoreoKind; label: string }[] = [
    { id: 'dance', label: `💃 ${uiText('Dance number')}` },
    { id: 'fight', label: `🥋 ${uiText('Fight')}` },
    { id: 'chase', label: `🏃 ${uiText('Chase')}` }
  ]

  return (
    <div className="panel-section">
      <div className="panel-title">{t('library.choreographer')}</div>
      <div className="field">
        <label>编舞类型</label>
        <CustomSelect
          value={kind}
          onChange={(value) => setKind(value as ChoreoKind)}
          options={KIND_LABELS.map((item) => ({ value: item.id, label: item.label }))}
        />
      </div>
      <div className="field-row">
        <div className="field" style={{ flex: 2 }}>
          <label>风格</label>
          <CustomSelect
            value={activeStyle}
            onChange={setStyle}
            options={styles.map((s) => ({ value: s.id, label: uiText(s.name) }))}
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>表演者</label>
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
          <label>时长（秒）</label>
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
            <label>结尾方式</label>
            <CustomSelect
              value={activeEnding}
              onChange={setEnding}
              options={endings.map((en) => ({ value: en.id, label: uiText(en.name) }))}
            />
          </div>
        )}
      </div>
      {kind === 'dance' && (
        <>
          <div className="field">
            <label>队形</label>
            <CustomSelect
              value={formation}
              onChange={(value) => setFormation(value as FormationId)}
              options={choreoFormations().map((f) => ({ value: f.id, label: uiText(f.name) }))}
            />
          </div>
          <div className="field-row" style={{ gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <input type="checkbox" checked={canon} onChange={(e) => setCanon(e.target.checked)} /> 领舞
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> 镜像
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={formationChange}
                onChange={(e) => setFormationChange(e.target.checked)}
              />{' '}
              队形变化
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
        <label>随机种子</label>
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
          <button className="btn small" title="重新生成随机种子" onClick={() => setSeed(randomSeed())}>
            🎲
          </button>
        </div>
      </div>
      <button
        className={`btn primary${placing ? ' active' : ''}`}
        style={{ width: '100%', marginBottom: 6 }}
        onClick={() => setPlacing(placing ? null : spec())}
        title="进入放置状态后点击地面布置编舞，队伍会面向相机；按 Esc 取消。每位表演者仍可编辑。"
      >
        {placing ? '⟳ 点击地面放置…（Esc 取消）' : '🎬 生成编舞'}
      </button>
      <button
        className="btn"
        style={{ width: '100%' }}
        onClick={onApply}
        title="用当前编舞替换已选表演者的动作（保留其外观）。"
      >
        {selCount > 0 ? `应用到已选 ${selCount} 个` : '应用到选择'}
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
  const { t } = useBlockoutI18n()
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
  const categoryLabels: Record<EntityCategory, string> = {
    people: t('library.people'),
    animals: t('library.animals'),
    vehicles: t('library.vehicles'),
    furniture: t('library.furniture'),
    props: t('library.props'),
    environment: t('library.environments'),
    primitives: t('library.primitives'),
    custom: t('library.custom')
  }

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = (a: AssetSpec): boolean =>
      q === '' ||
      a.name.toLowerCase().includes(q) ||
      a.category.toLowerCase().includes(q)
    return CATEGORY_ORDER.filter(
      ({ key }) => categoryFilter === 'all' || key === categoryFilter
    ).map(({ key }) => ({
      key,
      title: categoryLabels[key],
      items: ASSET_CATALOG.filter((a) => a.category === key && matches(a))
    })).filter((g) => g.items.length > 0)
  }, [categoryFilter, categoryLabels, query])

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
          placeholder={t('library.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* Browse controls: filter to one category, or place from a list. */}
      <div className="panel-section" style={{ paddingBottom: 4 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <CustomSelect
            value={categoryFilter}
            onChange={(value) => setCategoryFilter(value as EntityCategory | 'all')}
            options={[
              { value: 'all', label: t('library.allCategories') },
              ...CATEGORY_ORDER.map((c) => ({ value: c.key, label: categoryLabels[c.key] }))
            ]}
            title="Show one category at a time"
          />
          <CustomSelect
            value={placingAssetId && ASSET_CATALOG.some((a) => a.id === placingAssetId) ? placingAssetId : ''}
            onChange={(value) => setPlacingAsset(value || null)}
            options={[{ value: '', label: t('library.placeFromList') }]}
            groups={CATEGORY_ORDER.map((c) => ({
              label: categoryLabels[c.key],
              options: ASSET_CATALOG.filter((a) => a.category === c.key).map((a) => ({
                value: a.id,
                label: `${thumbFor(a.id)} ${uiText(a.name)}`
              }))
            }))}
            title="Pick from the full list — then click the floor to place it"
          />
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
                  <span className="name">{uiText(asset.name)}</span>
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
          ✨ {t('library.populate')}
        </button>
        <button className="btn" style={{ width: '100%', marginBottom: 8 }} onClick={() => void onImport()}>
          {t('library.importModel')}
        </button>
        <button
          className="btn"
          style={{ width: '100%' }}
          onClick={() => void onImportScan()}
          title="Load a Gaussian-splat scan of a real location (.ply/.splat/.ksplat/.spz) and block your scene inside it. Scan with any phone app (Polycam, Luma, Scaniverse) or a video-to-3D tool. Editor staging only — scans never appear in exports."
        >
          🏙 {t('library.importScan')}
        </button>
        <p style={{ color: 'var(--text-faint)', fontSize: 10.5, lineHeight: 1.4, margin: '6px 0 0' }}>
          扫描：用手机捕捉真实地点，然后在其中布景和安排走位。
        </p>
      </div>
    </>
  )
}
