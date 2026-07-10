import changelog from "../../../CHANGELOG.md?raw";

import { parseChangelog, type ReleaseInfo } from "@/lib/release";

export const localReleases: ReleaseInfo[] = parseChangelog(changelog);
