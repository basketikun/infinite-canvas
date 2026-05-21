import { loadChangelog } from "@/lib/changelog";

import { ChangelogView } from "./changelog-view";

export const dynamic = "force-static";

export default function ChangelogPage() {
  const versions = loadChangelog();
  return <ChangelogView versions={versions} />;
}
