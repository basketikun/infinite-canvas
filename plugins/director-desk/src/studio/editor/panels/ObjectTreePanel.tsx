import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Box, Camera, ChevronDown, ChevronRight, Eye, EyeOff, Layers, Lock, Search, Unlock, User, Users } from "lucide-react";
import type { DirectorObject, DirectorObjectKind } from "../schema/directorProject";
import { useDirectorStore } from "../store/directorStore";

type SceneTreePreviewItem = {
  id: string;
  name: string;
  icon: ObjectTreeIconKind;
};

type SceneTreeItem = {
  id: string;
  name: string;
  icon: ObjectTreeIconKind;
  object?: DirectorObject;
  objectIds: string[];
  crowdId?: string;
  previewChildren?: SceneTreePreviewItem[];
};

type ObjectTreeIconKind = "character" | "crowd" | "geometry" | "model" | "camera";

const GROUP_LABELS: Array<{
  key: string;
  title: string;
}> = [
  { key: "characters", title: "角色" },
  { key: "crowd", title: "群众" },
  { key: "geometry", title: "几何体" },
  { key: "my-models", title: "我的模型" },
  { key: "cameras", title: "摄像机" },
];

function ObjectKindIcon({ icon }: { icon: ObjectTreeIconKind }) {
  const iconProps = { "aria-hidden": true, size: 16, strokeWidth: 1.8 } as const;

  return (
    <span className="object-row-kind-icon" data-testid={`object-row-icon-${icon}`}>
      {icon === "camera" ? <Camera {...iconProps} /> : null}
      {icon === "crowd" ? <Users {...iconProps} /> : null}
      {icon === "geometry" || icon === "model" ? <Box {...iconProps} /> : null}
      {icon === "character" ? <User {...iconProps} /> : null}
    </span>
  );
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function ObjectTreePanel() {
  const [query, setQuery] = useState("");
  const [expandedCrowdIds, setExpandedCrowdIds] = useState<string[]>([]);
  const assets = useDirectorStore((state) => state.project.assets);
  const objects = useDirectorStore((state) => state.project.objects);
  const selectedObjectId = useDirectorStore((state) => state.selectedObjectId);
  const selectedObjectIds = useDirectorStore((state) => state.selectedObjectIds);
  const selectedCrowdId = useDirectorStore((state) => state.selectedCrowdId);
  const selectObject = useDirectorStore((state) => state.selectObject);
  const selectCrowd = useDirectorStore((state) => state.selectCrowd);
  const toggleObjectSelection = useDirectorStore((state) => state.toggleObjectSelection);
  const setActiveCamera = useDirectorStore((state) => state.setActiveCamera);
  const toggleObjectVisible = useDirectorStore((state) => state.toggleObjectVisible);
  const toggleObjectLocked = useDirectorStore((state) => state.toggleObjectLocked);
  const deleteSelectedObject = useDirectorStore((state) => state.deleteSelectedObject);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (isEditableKeyboardTarget(event.target)) return;
      const state = useDirectorStore.getState();
      if (!state.selectedObjectId && state.selectedObjectIds.length === 0) return;

      event.preventDefault();
      deleteSelectedObject();
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [deleteSelectedObject]);

  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const isModelBackedObject = (object: DirectorObject | undefined) => {
    if (!object?.assetRefId) return false;

    const asset = assetsById.get(object.assetRefId);
    return !asset || asset.sourceType === "model";
  };

  const groupedItems = useMemo(() => {
    const crowdItems = new Map<string, SceneTreeItem>();
    const regularItems: SceneTreeItem[] = [];

    objects.forEach((object) => {
      if (object.kind === "character" && object.crowdId && object.crowdLabel) {
        const existing = crowdItems.get(object.crowdId);
        if (existing) {
          existing.objectIds.push(object.id);
          existing.previewChildren = [
            ...(existing.previewChildren ?? []),
            {
              id: object.id,
              name: object.name,
              icon: "character",
            },
          ];
          return;
        }

        crowdItems.set(object.crowdId, {
          id: object.crowdId,
          name: object.crowdLabel,
          icon: "crowd",
          crowdId: object.crowdId,
          objectIds: [object.id],
          previewChildren: [
            {
              id: object.id,
              name: object.name,
              icon: "character",
            },
          ],
        });
        return;
      }

      regularItems.push({
        id: object.id,
        name: object.name,
        icon:
          object.kind === "camera"
            ? "camera"
            : object.kind === "character"
              ? "character"
              : isModelBackedObject(object)
                ? "model"
                : "geometry",
        object,
        objectIds: [object.id],
      });
    });

    return {
      characters: regularItems.filter((item) => item.object?.kind === "character"),
      crowd: Array.from(crowdItems.values()),
      geometry: regularItems.filter(
        (item) =>
          (item.object?.kind === "scene" && !isModelBackedObject(item.object)) ||
          (item.object?.kind === "prop" && !item.object?.assetRefId)
      ),
      myModels: regularItems.filter((item) => isModelBackedObject(item.object)),
      cameras: regularItems.filter((item) => item.object?.kind === "camera"),
    };
  }, [objects, assetsById]);

  useEffect(() => {
    const crowdIds = new Set(groupedItems.crowd.map((item) => item.id));
    setExpandedCrowdIds((current) => current.filter((crowdId) => crowdIds.has(crowdId)));
  }, [groupedItems.crowd]);

  const filteredGroups = GROUP_LABELS.map((group) => {
    const itemsByGroup =
      group.key === "characters"
        ? groupedItems.characters
        : group.key === "crowd"
          ? groupedItems.crowd
          : group.key === "geometry"
            ? groupedItems.geometry
            : group.key === "my-models"
              ? groupedItems.myModels
              : groupedItems.cameras;

    const filteredItems = itemsByGroup
      .map((item) => {
        if (!query.trim()) return item;

        const matchedPreviewChildren = item.previewChildren?.filter((child) => child.name.includes(query)) ?? [];
        if (!item.name.includes(query) && matchedPreviewChildren.length === 0) return null;

        return matchedPreviewChildren.length
          ? {
              ...item,
              previewChildren: matchedPreviewChildren,
            }
          : item;
      })
      .filter((item): item is SceneTreeItem => Boolean(item));

    return {
      ...group,
      items: filteredItems,
    };
  }).filter((group) => group.items.length > 0);
  const hasEmptySearchResult = query.trim().length > 0 && filteredGroups.length === 0;

  function selectTreeItem(item: SceneTreeItem, event: MouseEvent<HTMLElement>) {
    if (item.crowdId) {
      const selectedIds = getSelectedIds();

      if (event.shiftKey) {
        const allSelected = item.objectIds.every((id) => selectedIds.includes(id));

        if (allSelected) {
          item.objectIds.forEach((id) => {
            if (getSelectedIds().includes(id)) {
              toggleObjectSelection(id);
            }
          });
          return;
        }

        item.objectIds.forEach((id) => {
          if (!getSelectedIds().includes(id)) {
            toggleObjectSelection(id);
          }
        });
        return;
      }

      selectCrowd(item.crowdId);
      return;
    }

    if (item.objectIds.length > 1) {
      const selectedIds = getSelectedIds();

      if (event.shiftKey) {
        const allSelected = item.objectIds.every((id) => selectedIds.includes(id));

        if (allSelected) {
          item.objectIds.forEach((id) => {
            if (getSelectedIds().includes(id)) {
              toggleObjectSelection(id);
            }
          });
          return;
        }

        item.objectIds.forEach((id) => {
          if (!getSelectedIds().includes(id)) {
            toggleObjectSelection(id);
          }
        });
        return;
      }

      const [firstId, ...restIds] = item.objectIds;
      selectObject(firstId ?? null);
      restIds.forEach((id) => toggleObjectSelection(id));
      return;
    }

    if (event.shiftKey) {
      toggleObjectSelection(item.id);
      return;
    }

    if (item.object?.kind === "camera" && item.object.linkedCameraId) {
      setActiveCamera(item.object.linkedCameraId);
      return;
    }
    selectObject(item.id);
  }

  function toggleCrowdExpanded(crowdId: string) {
    setExpandedCrowdIds((current) =>
      current.includes(crowdId) ? current.filter((item) => item !== crowdId) : [...current, crowdId]
    );
  }

  function getSelectedIds() {
    const state = useDirectorStore.getState();
    if (state.selectedObjectIds.length) return state.selectedObjectIds;
    return state.selectedObjectId ? [state.selectedObjectId] : [];
  }

  return (
    <section className="panel-card object-tree-panel">
      <h2 className="scene-heading"><Layers size={15} aria-hidden />场景对象</h2>
      <label className="object-search-field">
        <Search aria-hidden="true" size={16} strokeWidth={1.8} />
        <input
          className="ui-field"
          aria-label="搜索场景内容"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索场景对象"
        />
      </label>
      {hasEmptySearchResult ? (
        <div className="object-search-empty-state" role="status" aria-label="未搜索到内容">
          <span className="object-search-empty-icon" data-testid="object-search-empty-icon">
            <Search aria-hidden="true" size={16} strokeWidth={1.8} />
          </span>
          <span>未搜索到内容</span>
        </div>
      ) : (
        <div className="object-tree-groups" role="tree" aria-label="场景对象列表">
          {filteredGroups.map((group) => (
            <section key={group.key} className="object-tree-group" role="group" aria-label={`${group.title}分组`}>
              <h3>{group.title}</h3>
              <ul className="object-list">
                {group.items.map((item) => {
                  const selected = item.crowdId
                    ? selectedCrowdId === item.crowdId || item.objectIds.every((id) => selectedObjectIds.includes(id))
                    : item.objectIds.length > 1
                      ? item.objectIds.every((id) => selectedObjectIds.includes(id))
                      : selectedObjectIds.length
                        ? selectedObjectIds.includes(item.id)
                        : item.id === selectedObjectId;
                  const expanded = item.crowdId ? expandedCrowdIds.includes(item.crowdId) : false;

                  return (
                    <li key={item.id} className="object-list-item">
                      <div
                        className={`object-row${selected ? " is-selected" : ""}${item.crowdId ? " object-row-crowd" : ""}`}
                        role="treeitem"
                        aria-label={item.name}
                        aria-selected={selected}
                        onClick={(event) => selectTreeItem(item, event)}
                      >
                        <div className="object-row-main">
                          {item.crowdId ? (
                            <button
                              aria-label={`${expanded ? "收起" : "展开"} ${item.name}`}
                              className="object-row-toggle-button"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleCrowdExpanded(item.crowdId as string);
                              }}
                            >
                              {expanded ? (
                                <ChevronDown aria-hidden="true" size={14} strokeWidth={1.8} />
                              ) : (
                                <ChevronRight aria-hidden="true" size={14} strokeWidth={1.8} />
                              )}
                            </button>
                          ) : null}
                          <button className="object-select-button" type="button">
                            <ObjectKindIcon icon={item.icon} />
                            <span>{item.name}</span>
                          </button>
                        </div>
                        {item.object ? (
                          <>
                            <button
                              className="object-flag-button object-icon-flag-button"
                              type="button"
                              aria-label={`${item.name} 可见性`}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleObjectVisible(item.id);
                              }}
                            >
                              {item.object.visible ? (
                                <Eye aria-hidden="true" size={15} strokeWidth={1.8} />
                              ) : (
                                <EyeOff aria-hidden="true" size={15} strokeWidth={1.8} />
                              )}
                            </button>
                            <button
                              className="object-flag-button object-icon-flag-button"
                              type="button"
                              aria-label={`${item.name} 锁定`}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleObjectLocked(item.id);
                              }}
                            >
                              {item.object.locked ? (
                                <Lock aria-hidden="true" size={15} strokeWidth={1.8} />
                              ) : (
                                <Unlock aria-hidden="true" size={15} strokeWidth={1.8} />
                              )}
                            </button>
                          </>
                        ) : null}
                      </div>
                      {item.crowdId && expanded && item.previewChildren?.length ? (
                        <ul className="object-crowd-preview-list" aria-label={`${item.name} 成员预览`}>
                          {item.previewChildren.map((child) => (
                            <li key={child.id}>
                              <div className={`object-row object-row-preview${selected ? " is-selected" : ""}`}>
                                <span className="object-row-preview-spacer" aria-hidden="true" />
                                <div className="object-row-main">
                                  <button
                                    className="object-select-button"
                                    type="button"
                                    onClick={(event) => selectTreeItem(item, event)}
                                  >
                                    <ObjectKindIcon icon={child.icon} />
                                    <span>{child.name}</span>
                                  </button>
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
