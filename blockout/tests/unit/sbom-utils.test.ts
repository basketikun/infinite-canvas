import { describe, expect, it } from 'vitest'
import { resolveSpdxRootId } from '../../scripts/sbom-utils.mjs'

describe('SBOM root package resolution', () => {
  it('uses npm documentDescribes for prerelease versions', () => {
    const rootId = 'SPDXRef-Package-blockout-5.0.0-windows.1'
    expect(resolveSpdxRootId({
      documentDescribes: [rootId],
      packages: [
        { name: 'dependency', SPDXID: 'SPDXRef-Package-dependency-1.0.0' },
        { name: 'blockout', SPDXID: rootId }
      ],
      relationships: [{
        spdxElementId: 'SPDXRef-DOCUMENT',
        relationshipType: 'DESCRIBES',
        relatedSpdxElement: rootId
      }]
    }, 'blockout')).toBe(rootId)
  })

  it('falls back to the single matching package for older npm documents', () => {
    expect(resolveSpdxRootId({
      packages: [{ name: 'blockout', SPDXID: 'SPDXRef-Package-blockout-custom' }]
    }, 'blockout')).toBe('SPDXRef-Package-blockout-custom')
  })
})
