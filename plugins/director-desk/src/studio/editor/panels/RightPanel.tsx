import { useDirectorStore } from "../store/directorStore";
import { selectRightPanelKind } from "../store/directorSelectors";
import { CameraPanel } from "./CameraPanel";
import { CharacterPanel } from "./CharacterPanel";
import { PropPanel } from "./PropPanel";
import { ScenePanel } from "./ScenePanel";

export function RightPanel() {
  const panelKind = useDirectorStore(selectRightPanelKind);

  if (panelKind === "character") return <CharacterPanel />;
  if (panelKind === "prop") return <PropPanel />;
  if (panelKind === "camera") return <CameraPanel />;
  return <ScenePanel />;
}
