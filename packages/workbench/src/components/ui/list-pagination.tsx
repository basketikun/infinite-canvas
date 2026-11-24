import Pagination from "@rc-component/pagination";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Ellipsis } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@infinite-canvas/plugin-sdk/ui/select";

export function ListPagination({ current, pageSize, total, onChange, showSizeChanger = true }: { current: number; pageSize: number; total: number; onChange: (page: number, size: number) => void; showSizeChanger?: boolean }) {
    return <Pagination prefixCls="list-pagination" current={current} pageSize={pageSize} total={total} onChange={onChange}
        prevIcon={<button type="button" tabIndex={-1} aria-label="上一页"><ChevronLeft /></button>}
        nextIcon={<button type="button" tabIndex={-1} aria-label="下一页"><ChevronRight /></button>}
        jumpPrevIcon={<><Ellipsis /><ChevronsLeft /></>} jumpNextIcon={<><Ellipsis /><ChevronsRight /></>}
        showSizeChanger={showSizeChanger} pageSizeOptions={[10, 20, 50, 100]}
        sizeChangerRender={({ size, disabled, onSizeChange, options, "aria-label": label }) => <Select value={String(size)} disabled={disabled} onValueChange={(value) => onSizeChange(Number(value))}>
            <SelectTrigger aria-label={label} className="list-pagination-size h-8 min-w-20 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent side="top">{options.map((option) => <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>)}</SelectContent>
        </Select>} />;
}
