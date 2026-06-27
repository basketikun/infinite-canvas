import { Suspense } from "react";
import CanvasPageContent from "./canvas-page-content";

export default function CanvasPage() {
    return (
        <Suspense>
            <CanvasPageContent />
        </Suspense>
    );
}
