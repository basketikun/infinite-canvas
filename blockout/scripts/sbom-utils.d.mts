export interface SpdxPackageLike {
  name?: string
  SPDXID?: string
}

export interface SpdxRelationshipLike {
  spdxElementId?: string
  relationshipType?: string
  relatedSpdxElement?: string
}

export interface SpdxDocumentLike {
  documentDescribes?: unknown[]
  packages?: SpdxPackageLike[]
  relationships?: SpdxRelationshipLike[]
}

export function resolveSpdxRootId(spdx: SpdxDocumentLike, packageName: string): string
