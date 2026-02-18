const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function createTestHospitals() {
  try {
    console.log('Creating test hospitals...');

    // Create the hospitals that the frontend expects
    const hospitals = [
      {
        id: 'fakeeh',
        name: 'Fakeeh',
        address: 'Dubai Healthcare City, Dubai, UAE',
        contactInfo: {
          phone: '+971-4-123-4567',
          email: 'info@fakeeh.com'
        }
      },
      {
        id: 'suliman',
        name: 'Suliman',
        address: 'Dubai Healthcare City, Dubai, UAE',
        contactInfo: {
          phone: '+971-4-234-5678',
          email: 'info@suliman.com'
        }
      },
      {
        id: 'monro',
        name: 'Monro',
        address: 'Dubai Healthcare City, Dubai, UAE',
        contactInfo: {
          phone: '+971-4-345-6789',
          email: 'info@monro.com'
        }
      },
      {
        id: 'hellenic',
        name: 'Hellenic',
        address: 'Dubai Healthcare City, Dubai, UAE',
        contactInfo: {
          phone: '+971-4-456-7890',
          email: 'info@hellenic.com'
        }
      },
      {
        id: 'rama',
        name: 'Rama',
        address: 'Dubai Healthcare City, Dubai, UAE',
        contactInfo: {
          phone: '+971-4-567-8901',
          email: 'info@rama.com'
        }
      },
      {
        id: 'luzan',
        name: 'Luzan',
        address: 'Dubai Healthcare City, Dubai, UAE',
        contactInfo: {
          phone: '+971-4-678-9012',
          email: 'info@luzan.com'
        }
      }
    ];

    for (const hospitalData of hospitals) {
      try {
        const hospital = await prisma.hospital.create({
          data: hospitalData
        });
        console.log(`✅ Created hospital: ${hospital.name} (ID: ${hospital.id})`);
      } catch (error) {
        if (error.code === 'P2002') {
          console.log(`⚠️  Hospital ${hospitalData.name} already exists, skipping...`);
        } else {
          console.error(`❌ Error creating hospital ${hospitalData.name}:`, error.message);
        }
      }
    }

    console.log('\n✅ Test hospitals creation completed!');
    
    // Verify hospitals were created
    const allHospitals = await prisma.hospital.findMany();
    console.log('\nAvailable hospitals in database:');
    allHospitals.forEach(h => console.log(`- ${h.name} (ID: ${h.id})`));

  } catch (error) {
    console.error('Error creating test hospitals:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestHospitals();
