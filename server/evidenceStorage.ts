import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export function createEvidenceStorage(root: string) {
  const pathFor = (assetId: string) => join(root, assetId.slice(0, 2), assetId)

  return {
    async save(assetId: string, bytes: Buffer): Promise<void> {
      const finalPath = pathFor(assetId)
      const temporaryPath = `${finalPath}.${crypto.randomUUID()}.tmp`
      await mkdir(dirname(finalPath), { recursive: true })
      const handle = await open(temporaryPath, 'wx', 0o600)
      try {
        await handle.writeFile(bytes)
        await handle.sync()
      } finally {
        await handle.close()
      }
      try {
        await rename(temporaryPath, finalPath)
      } catch (error) {
        await rm(temporaryPath, { force: true })
        throw error
      }
    },
    async read(assetId: string): Promise<Buffer> {
      return readFile(pathFor(assetId))
    },
    async remove(assetId: string): Promise<void> {
      await rm(pathFor(assetId), { force: true })
    },
  }
}

export type EvidenceStorage = ReturnType<typeof createEvidenceStorage>
