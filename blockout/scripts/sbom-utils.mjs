/** Resolve the application package ID emitted by npm's SPDX generator. */
export function resolveSpdxRootId(spdx, packageName) {
  const packages = Array.isArray(spdx?.packages) ? spdx.packages : []
  const describedIds = new Set([
    ...(Array.isArray(spdx?.documentDescribes) ? spdx.documentDescribes : []),
    ...(Array.isArray(spdx?.relationships)
      ? spdx.relationships
        .filter((relationship) =>
          relationship?.spdxElementId === 'SPDXRef-DOCUMENT' &&
          relationship?.relationshipType === 'DESCRIBES')
        .map((relationship) => relationship.relatedSpdxElement)
      : [])
  ].filter((id) => typeof id === 'string'))

  const describedPackage = packages.find((entry) =>
    entry?.name === packageName && describedIds.has(entry?.SPDXID))
  if (typeof describedPackage?.SPDXID === 'string') return describedPackage.SPDXID

  // Older npm versions may omit documentDescribes while still emitting a
  // single package whose name matches the project.
  const matchingPackages = packages.filter((entry) =>
    entry?.name === packageName && typeof entry?.SPDXID === 'string')
  if (matchingPackages.length === 1) return matchingPackages[0].SPDXID

  throw new Error(`Unable to resolve SPDX root package for ${packageName}`)
}
