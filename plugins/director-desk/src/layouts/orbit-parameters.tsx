import type { CameraLayoutParametersProps } from "../api/camera-layouts";
import { Input } from "@infinite-canvas/plugin-sdk/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@infinite-canvas/plugin-sdk/ui/select";
import type { OrbitOptions } from "./orbit";

export function OrbitParameters({ scene, value, onChange }: CameraLayoutParametersProps<OrbitOptions>) {
    return <div className="space-y-3 text-sm">
        <label className="grid gap-1">目标对象
            <Select value={value.targetObjectId ?? ""} onValueChange={targetObjectId => onChange({ ...value, targetObjectId })}>
                <SelectTrigger className="w-full" aria-label="目标对象"><SelectValue placeholder="选择目标对象" /></SelectTrigger>
                <SelectContent>{scene.objects.filter(object => object.visible && object.focusTarget).map(object => <SelectItem key={object.id} value={object.id}>{object.name}</SelectItem>)}</SelectContent>
            </Select>
        </label>
        {([ ["distance", "距离"], ["height", "相对目标高度"], ["count", "镜头数量"] ] as const).map(([field, title]) => <label key={field} className="grid gap-1">{title}
            <Input type="number" step={field === "count" ? 1 : "any"} value={value[field] ?? ""} onChange={event => onChange({ ...value, [field]: event.currentTarget.value === "" ? undefined : event.currentTarget.valueAsNumber })} />
        </label>)}
    </div>;
}
