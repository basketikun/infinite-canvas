import { Input } from "@infinite-canvas/plugin-sdk/ui/input";
import { Switch } from "@infinite-canvas/plugin-sdk/ui/switch";
import { Eye, EyeOff } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";

export function SettingsPasswordInput({ id, label, value, ...props }: Omit<ComponentProps<typeof Input>, "type" | "ref" | "value" | "defaultValue"> & { id: string; label: string; value: string }) {
    const [visible, setVisible] = useState(false);
    const input = useRef<HTMLInputElement>(null);
    useLayoutEffect(() => {
        // 只回填输入框的实时值，避免把密钥写入可序列化的 HTML 属性。
        const field = input.current!;
        if (field.value !== value) field.value = value;
    }, [value]);
    return (
        <div className="settings-network-field flex items-center gap-1">
            <Input {...props} ref={input} id={id} type={visible ? "text" : "password"} />
            <button type="button" aria-controls={id} aria-pressed={visible} aria-label={`${visible ? "隐藏" : "显示"}${label}`} onMouseDown={(event) => event.preventDefault()} onClick={() => setVisible(!visible)}>
                {visible ? <Eye aria-hidden className="size-3.5" /> : <EyeOff aria-hidden className="size-3.5" />}
            </button>
        </div>
    );
}

export function SettingsNetworkSwitch({ checked, onCheckedChange, ...props }: Pick<ComponentProps<typeof Switch>, "id" | "size" | "aria-label" | "aria-labelledby" | "aria-describedby"> & { checked: boolean; onCheckedChange: (checked: boolean) => void }) {
    return <Switch {...props} className="settings-network-switch" checked={checked} onCheckedChange={onCheckedChange} onKeyDown={(event) => {
        if (event.key === "ArrowLeft" && checked) onCheckedChange(false);
        if (event.key === "ArrowRight" && !checked) onCheckedChange(true);
    }} />;
}
