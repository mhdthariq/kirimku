import { PrismaClient } from '@prisma/client'
import path from 'path'

// process.cwd() akan selalu mengarah ke root folder proyek Anda,
// sehingga tidak akan tersesat saat Next.js berjalan dalam mode production.
const customDbPath = path.join(process.cwd(), 'db', 'custom.db')

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
    datasources: {
      db: {
        // Ini akan menimpa string koneksi dari .env secara dinamis
        url: `file:${customDbPath}`,
      },
    },
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
