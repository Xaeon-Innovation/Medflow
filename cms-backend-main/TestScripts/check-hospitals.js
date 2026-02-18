const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkHospitals() {
  try {
    const hospitals = await prisma.hospital.findMany();
    console.log('Available hospitals:');
    hospitals.forEach(h => console.log(`ID: ${h.id}, Name: ${h.name}`));
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkHospitals();
