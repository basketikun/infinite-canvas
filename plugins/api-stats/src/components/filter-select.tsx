import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@infinite-canvas/plugin-sdk/ui/select";

export function FilterSelect({ label, value, options, onChange, open, onOpenChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; open: boolean; onOpenChange: (open: boolean) => void }) {
    return <Select open={open} onOpenChange={onOpenChange} value={JSON.stringify(value)} onValueChange={(value) => onChange(JSON.parse(value))}>
        <SelectTrigger aria-label={label} className="api-stats-filter"><SelectValue /></SelectTrigger>
        <SelectContent position="popper" align="start">{options.map((option) => <SelectItem key={option.value} value={JSON.stringify(option.value)}>{option.label}</SelectItem>)}</SelectContent>
    </Select>;
}
