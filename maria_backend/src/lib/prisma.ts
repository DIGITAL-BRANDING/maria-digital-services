import { PrismaClient } from '@prisma/client';

const prismaClientSingleton = () => {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error', 'warn']
  });
};

declare global {
  var prisma: undefined | ReturnType<typeof prismaClientSingleton>;
}

export const prisma = globalThis.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma;

// Handle Prisma client connection errors
prisma.$connect()
  .then(() => {
    console.log('✓ Database connected successfully');
  })
  .catch((error) => {
    console.error('✗ Failed to connect to database:', error.message);
    process.exit(1);
  });

// Handle unexpected disconnections
process.on('exit', async () => {
  await prisma.$disconnect();
});
